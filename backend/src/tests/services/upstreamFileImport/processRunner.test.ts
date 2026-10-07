/**
 * The rsync image import's process runner (services/upstreamFileImport/processRunner.ts):
 * spawn with shell:false and EXACTLY the given environment; bounded by a timeout, an abort
 * signal and an output cap; a missing tool is an answer, not a throw.
 *
 * The real-process cases run Node itself as the child (present on every machine that runs the
 * suite); the spawn-option cases replace spawn with a recording double.
 */
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";
import { KILL_GRACE_MS, MAX_KEPT_OUTPUT, runProcess, setSpawn } from "../../../services/upstreamFileImport/processRunner";
import { environment } from "../../../config/env";

const penv = environment();

const NODE = process.execPath;
const ENV = { PATH: "/usr/bin:/bin", HOME: "/tmp", SYSTEMROOT: "C:\\Windows" };

describe("runProcess — a real child", () => {
  it("answers the exit code and both streams", async () => {
    const result = await runProcess({
      file: NODE,
      args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
      env: ENV,
      timeoutMs: 20_000,
    });
    expect(result).toMatchObject({ code: 3, stdout: "out", stderr: "err", timedOut: false, aborted: false, spawnError: null });
  });

  it("gives the child ONLY the environment it is handed — nothing of this process", async () => {
    // A variable of THIS process (the stand-in for DB_PASS, KMS_MASTER_KEY …) must not reach the child.
    // (Windows adds its own session variables to every child; Linux, where the import runs, adds none.)
    penv["UPSTREAM_RUNNER_LEAK_PROBE"] = "leak";
    try {
      const result = await runProcess({
        file: NODE,
        args: ["-e", "process.stdout.write(JSON.stringify(process.env))"],
        env: { ...ENV, SSHPASS: "probe" },
        timeoutMs: 20_000,
      });
      const childEnv = JSON.parse(result.stdout) as Record<string, string>;
      expect(childEnv).not.toHaveProperty("UPSTREAM_RUNNER_LEAK_PROBE");
      expect(childEnv).not.toHaveProperty("DB_PASS");
      expect(childEnv).toMatchObject({ HOME: "/tmp", PATH: "/usr/bin:/bin", SSHPASS: "probe" });
    } finally {
      delete penv["UPSTREAM_RUNNER_LEAK_PROBE"];
    }
  });

  it("streams stdout chunks to onStdout and runs in cwd", async () => {
    const chunks: string[] = [];
    const result = await runProcess({
      file: NODE,
      args: ["-e", "process.stdout.write(process.cwd())"],
      env: ENV,
      cwd: __dirname,
      timeoutMs: 20_000,
      onStdout: (chunk) => chunks.push(chunk),
    });
    expect(chunks.join("")).toBe(result.stdout);
    expect(result.stdout.toLowerCase()).toBe(__dirname.toLowerCase());
  });

  it("kills a child that outlives its timeout", async () => {
    const result = await runProcess({ file: NODE, args: ["-e", "setInterval(() => {}, 1000)"], env: ENV, timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.code === null || result.code !== 0).toBe(true);
  });

  it("kills a child when the signal aborts, and when it was aborted before the start", async () => {
    const controller = new AbortController();
    const running = runProcess({ file: NODE, args: ["-e", "setInterval(() => {}, 1000)"], env: ENV, timeoutMs: 20_000, signal: controller.signal });
    setTimeout(() => { controller.abort(); }, 200);
    expect((await running).aborted).toBe(true);
    const already = await runProcess({ file: NODE, args: ["-e", "setInterval(() => {}, 1000)"], env: ENV, timeoutMs: 20_000, signal: controller.signal });
    expect(already.aborted).toBe(true);
  });

  it("a tool that is not installed answers spawnError ENOENT", async () => {
    const result = await runProcess({ file: "definitely-not-a-tool-7f3a", args: [], env: ENV, timeoutMs: 5_000 });
    expect(result.spawnError).toBe("ENOENT");
    expect(result.code).toBeNull();
  });
});

describe("runProcess — spawn options and bounds (a spawn double)", () => {
  class FakeChild extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    kills: string[] = [];
    kill(signal: string): boolean {
      this.kills.push(signal);
      return true;
    }
  }

  let child: FakeChild;
  let calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[];
  let restore: ReturnType<typeof setSpawn>;

  beforeEach(() => {
    calls = [];
    child = new FakeChild();
    restore = setSpawn((file, args, options) => {
      calls.push({ file, args, options: options as Record<string, unknown> });
      return child as unknown as ChildProcess;
    });
  });

  afterEach(() => {
    setSpawn(restore);
    jest.useRealTimers();
  });

  it("never asks for a shell, hides the window, and passes a copy of the environment", async () => {
    const env = { PATH: "/bin" };
    const running = runProcess({ file: "rsync", args: ["--", "a b; rm -rf /"], env, timeoutMs: 1_000 });
    child.emit("close", 0, null);
    await running;
    expect(calls[0]).toMatchObject({ file: "rsync", args: ["--", "a b; rm -rf /"] });
    expect(calls[0]?.options).toMatchObject({ shell: false, windowsHide: true, env: { PATH: "/bin" } });
    expect(calls[0]?.options["env"]).not.toBe(env);
    expect(calls[0]?.options).not.toHaveProperty("cwd");
  });

  it("keeps only the tail of a long output", async () => {
    const running = runProcess({ file: "rsync", args: [], env: {}, timeoutMs: 1_000 });
    child.stdout.write("a".repeat(MAX_KEPT_OUTPUT));
    child.stdout.write("TAIL");
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("close", 0, null);
    const result = await running;
    expect(result.stdout).toHaveLength(MAX_KEPT_OUTPUT);
    expect(result.stdout.endsWith("TAIL")).toBe(true);
  });

  it("SIGTERM at the timeout, SIGKILL after the grace period; settles once", async () => {
    jest.useFakeTimers();
    const running = runProcess({ file: "rsync", args: [], env: {}, timeoutMs: 1_000 });
    jest.advanceTimersByTime(1_000);
    expect(child.kills).toEqual(["SIGTERM"]);
    jest.advanceTimersByTime(KILL_GRACE_MS);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    child.emit("close", null, "SIGKILL");
    child.emit("close", 1, null);
    child.emit("error", new Error("late"));
    await expect(running).resolves.toMatchObject({ code: null, signal: "SIGKILL", timedOut: true });
  });

  it("an error without a code answers its message", async () => {
    const running = runProcess({ file: "rsync", args: [], env: {}, timeoutMs: 1_000 });
    child.emit("error", new Error("spawn failed"));
    await expect(running).resolves.toMatchObject({ spawnError: "spawn failed" });
  });
});
