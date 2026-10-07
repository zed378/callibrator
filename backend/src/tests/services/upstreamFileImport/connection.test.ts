/**
 * The rsync image import's conversations with the source (services/upstreamFileImport/
 * connection.ts): every outcome becomes a stable code; the password is in the child's
 * environment only; the private key and the pinned known_hosts are 0600 files in the run's
 * scratch, wiped when it is disposed. spawn is a recording double — no process runs.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";
import { setSpawn } from "../../../services/upstreamFileImport/processRunner";
import {
  classifyFailure,
  listRemote,
  openSession,
  parseProgress,
  parseStats,
  scanHostKeys,
  transferRemote,
  type SessionInput,
} from "../../../services/upstreamFileImport/connection";
import { createRunScratch } from "../../../services/upstreamFileImport/workspace";
import { fingerprintOf } from "../../../services/upstreamFileImport/hostKeys";
import { HOST_KEY_ALIAS } from "../../../constants/upstreamFileImport";
import { environment } from "../../../config/env";
import type { ProcessResult } from "../../../services/upstreamFileImport/processRunner";

const penv = environment();
const PASSWORD = "s3cret-pw-probe";
const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAsynthetic\n-----END OPENSSH PRIVATE KEY-----";
const ED = Buffer.from("synthetic-ed25519").toString("base64");

/** A scripted child: what it prints, how it ends. */
interface Script {
  stdout?: string[];
  stderr?: string;
  code?: number | null;
  error?: NodeJS.ErrnoException;
}

let calls: { file: string; args: readonly string[]; env: Record<string, string> }[];
let scripts: Script[];
let restore: ReturnType<typeof setSpawn>;
let workDir: string;

beforeEach(() => {
  calls = [];
  scripts = [];
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsync-conn-"));
  penv["UPSTREAM_FILE_IMPORT_DIR"] = workDir;
  restore = setSpawn((file, args, options) => {
    calls.push({ file, args, env: (options as { env: Record<string, string> }).env });
    const script = scripts.shift() ?? { code: 0 };
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    setImmediate(() => {
      if (script.error) {
        child.emit("error", script.error);
        return;
      }
      for (const chunk of script.stdout ?? []) {
        child.stdout.write(chunk);
      }
      if (script.stderr) {
        child.stderr.write(script.stderr);
      }
      setImmediate(() => child.emit("close", script.code ?? 0, null));
    });
    return child as unknown as ChildProcess;
  });
});

afterEach(() => {
  setSpawn(restore);
  delete penv["UPSTREAM_FILE_IMPORT_DIR"];
  fs.rmSync(workDir, { recursive: true, force: true });
});

const result = (over: Partial<ProcessResult>): ProcessResult => ({
  code: 1,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  aborted: false,
  spawnError: null,
  ...over,
});

describe("classifyFailure — stable codes, never the tool's message", () => {
  it.each([
    [{ spawnError: "ENOENT" }, "tool_missing"],
    [{ aborted: true }, "cancelled"],
    [{ timedOut: true }, "timeout"],
    [{ stderr: "Host key verification failed." }, "host_key_mismatch"],
    [{ stderr: "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @" }, "host_key_mismatch"],
    [{ code: 6 }, "host_key_mismatch"],
    [{ stderr: "importer@203.0.113.7: Permission denied (publickey,password)." }, "auth_failed"],
    [{ stderr: "Received disconnect: Too many authentication failures" }, "auth_failed"],
    [{ code: 5 }, "auth_failed"],
    [{ stderr: "ssh: connect to host 203.0.113.7 port 22: Connection refused" }, "unreachable"],
    [{ stderr: "ssh: connect to host x port 22: No route to host" }, "unreachable"],
    [{ stderr: 'rsync: change_dir "/srv/x/foto_sn" failed: No such file or directory (2)' }, "path_not_found"],
    [{ stderr: 'rsync: opendir "/srv/x/foto_sn" failed: Permission denied (13)' }, "path_not_readable"],
    [{ stderr: "rsync error: something else (code 12)" }, "transfer_failed"],
  ])("%j → %s", (over, code) => {
    expect(classifyFailure(result(over as Partial<ProcessResult>))).toBe(code);
  });
});

describe("parseStats / parseProgress", () => {
  it("reads regular files and bytes from --stats", () => {
    const stats = "Number of files: 1,204 (reg: 1,200, dir: 4)\nTotal file size: 2,345,678,901 bytes\n";
    expect(parseStats(stats)).toEqual({ files: 1200, bytes: 2345678901 });
  });

  it("a folder of directories only has no regular files", () => {
    expect(parseStats("Number of files: 3 (dir: 3)\nTotal file size: 0 bytes\n")).toEqual({ files: 0, bytes: 0 });
    expect(parseStats("")).toEqual({ files: 0, bytes: 0 });
  });

  it("reads the last progress2 line of a chunk", () => {
    const chunk = "      1,024  10%  1.00MB/s    0:00:01 (xfr#1, to-chk=9/10)\r     2,048  20%  1.00MB/s    0:00:02 (xfr#2, to-chk=8/10)\r";
    expect(parseProgress(chunk)).toEqual({ bytes: 2048, files: 2 });
    expect(parseProgress("      4,096  40%  1.00MB/s    0:00:03  \n")).toEqual({ bytes: 4096, files: 0 });
    expect(parseProgress("sending incremental file list\n")).toBeNull();
  });
});

const input = (over: Partial<SessionInput> = {}): SessionInput => ({
  address: "203.0.113.7",
  port: 2222,
  username: "importer",
  authMethod: "password",
  password: PASSWORD,
  pinned: { type: "ssh-ed25519", key: ED },
  ...over,
});

describe("openSession — the pinned key and the private key are 0600 files, wiped on dispose", () => {
  it("password: known_hosts holds exactly the pinned key; SSHPASS in the env; no key file", async () => {
    const scratch = await createRunScratch();
    const session = await openSession(input(), scratch, 9);
    const knownHosts = path.join(scratch.dir, "known_hosts");
    expect(fs.readFileSync(knownHosts, "utf8")).toBe(`${HOST_KEY_ALIAS} ssh-ed25519 ${ED}\n`);
    if (process.platform !== "win32") {
      expect(fs.statSync(knownHosts).mode & 0o777).toBe(0o600);
    }
    expect(session.env["SSHPASS"]).toBe(PASSWORD);
    expect(session.sshCommand).not.toContain(PASSWORD);
    expect(session.sshCommand).toContain("ConnectTimeout=9");
    expect(fs.existsSync(path.join(scratch.dir, "id_source"))).toBe(false);
    await scratch.dispose();
    expect(fs.existsSync(scratch.dir)).toBe(false);
  });

  it("key: the key file is written (with a final newline), named by -i, no SSHPASS", async () => {
    const scratch = await createRunScratch();
    const session = await openSession(input({ authMethod: "key", password: null, privateKey: KEY }), scratch);
    const keyFile = path.join(scratch.dir, "id_source");
    expect(fs.readFileSync(keyFile, "utf8")).toBe(`${KEY}\n`);
    expect(session.sshCommand).toContain(`-i ${keyFile.split(path.sep).join("/")}`);
    expect(session.env).not.toHaveProperty("SSHPASS");
    await scratch.dispose();
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it("key: a key already ending in a newline is written as it is; a missing key writes an empty file", async () => {
    const scratch = await createRunScratch();
    await openSession(input({ authMethod: "key", privateKey: `${KEY}\n` }), scratch);
    expect(fs.readFileSync(path.join(scratch.dir, "id_source"), "utf8")).toBe(`${KEY}\n`);
    await scratch.dispose();
    const second = await createRunScratch();
    await openSession(input({ authMethod: "key", privateKey: null }), second);
    expect(fs.readFileSync(path.join(second.dir, "id_source"), "utf8")).toBe("\n");
    await second.dispose();
  });
});

describe("scanHostKeys", () => {
  it("answers the scanned keys (ssh-keyscan, the address after --, a bounded timeout)", async () => {
    scripts.push({ stdout: [`203.0.113.7 ssh-ed25519 ${ED}\n`] });
    const answer = await scanHostKeys("203.0.113.7", 2222, 120_000, workDir);
    expect(answer).toEqual({ ok: true, keys: [{ type: "ssh-ed25519", key: ED, fingerprint: fingerprintOf(ED) }] });
    expect(calls[0]?.file).toBe("ssh-keyscan");
    expect(calls[0]?.args).toEqual(["-T", "60", "-p", "2222", "-t", "ed25519,ecdsa,rsa", "--", "203.0.113.7"]);
    expect(calls[0]?.env).not.toHaveProperty("SSHPASS");
  });

  it("no key → unreachable; not installed → tool_missing; a minimum one-second scan timeout", async () => {
    scripts.push({ stdout: [""] });
    expect(await scanHostKeys("203.0.113.7", 22, 10, workDir)).toEqual({ ok: false, error: "unreachable" });
    expect(calls[0]?.args.slice(0, 2)).toEqual(["-T", "1"]);
    scripts.push({ error: Object.assign(new Error("spawn ssh-keyscan ENOENT"), { code: "ENOENT" }) });
    expect(await scanHostKeys("203.0.113.7", 22, 1000, workDir)).toEqual({ ok: false, error: "tool_missing" });
  });

  it("a scan that outlives its timeout → timeout", async () => {
    restore = setSpawn((() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => {
          setImmediate(() => child.emit("close", null, "SIGTERM"));
          return true;
        },
      });
      return child as unknown as ChildProcess;
    }));
    // Restored to the scripted double by afterEach's setSpawn(restore) — here `restore` is the double.
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
    const running = scanHostKeys("203.0.113.7", 22, 1000, workDir);
    jest.advanceTimersByTime(6_000);
    jest.useRealTimers();
    expect(await running).toEqual({ ok: false, error: "timeout" });
  });
});

describe("listRemote and transferRemote", () => {
  it("lists through sshpass with the password in the environment ONLY", async () => {
    const scratch = await createRunScratch();
    const session = await openSession(input(), scratch);
    scripts.push({ stdout: ["Number of files: 5 (reg: 4, dir: 1)\nTotal file size: 4,096 bytes\n"] });
    const answer = await listRemote(session, "/srv/uploads/foto_depan", "/tmp/empty", 30_000, 30);
    expect(answer).toEqual({ ok: true, files: 4, bytes: 4096 });
    const call = calls[0];
    expect(call?.file).toBe("sshpass");
    expect(call?.args).toContain("--dry-run");
    expect(call?.args.slice(-3)).toEqual(["--", "importer@203.0.113.7:/srv/uploads/foto_depan/", "/tmp/empty/"]);
    expect(call?.args.join("\u0000")).not.toContain(PASSWORD);
    expect(call?.env["SSHPASS"]).toBe(PASSWORD);
    await scratch.dispose();
  });

  it("a failed listing answers its code", async () => {
    const scratch = await createRunScratch();
    const session = await openSession(input({ authMethod: "key", password: null, privateKey: KEY }), scratch);
    scripts.push({ code: 23, stderr: 'rsync: change_dir "/srv/x/foto_sn" failed: No such file or directory (2)' });
    expect(await listRemote(session, "/srv/x/foto_sn", "/tmp/e", 30_000, 30)).toEqual({ ok: false, error: "path_not_found" });
    expect(calls[0]?.file).toBe("rsync");
    await scratch.dispose();
  });

  it("transfers with progress, a bandwidth limit, and reads what was copied", async () => {
    const scratch = await createRunScratch();
    const session = await openSession(input(), scratch);
    scripts.push({
      stdout: [
        "      1,024  50%  1.00MB/s    0:00:01 (xfr#1, to-chk=1/2)\r",
        "noise without progress\n",
        "Number of regular files transferred: 2\nTotal transferred file size: 2,048 bytes\n",
      ],
    });
    const seen: unknown[] = [];
    const answer = await transferRemote(session, {
      remoteDir: "/srv/uploads/foto_sn",
      localDir: "/staging/foto_sn",
      ioTimeoutSec: 300,
      timeoutMs: 60_000,
      bandwidthLimitKbps: 512,
      signal: new AbortController().signal,
      onProgress: (p) => seen.push(p),
    });
    expect(answer).toEqual({ ok: true, files: 2, bytes: 2048 });
    expect(seen).toEqual([{ bytes: 1024, files: 1 }]);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(["--partial", "--bwlimit=512", "--info=progress2"]));
    await scratch.dispose();
  });

  it("a failed transfer answers its code", async () => {
    const scratch = await createRunScratch();
    const session = await openSession(input(), scratch);
    scripts.push({ code: 255, stderr: "Host key verification failed." });
    const answer = await transferRemote(session, {
      remoteDir: "/srv/x",
      localDir: "/staging/x",
      ioTimeoutSec: 300,
      timeoutMs: 60_000,
      bandwidthLimitKbps: null,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    expect(answer).toEqual({ ok: false, error: "host_key_mismatch" });
    await scratch.dispose();
  });
});
