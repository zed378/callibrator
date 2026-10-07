/**
 * Run one external tool (rsync, ssh-keyscan, sshpass) for the rsync image import.
 *
 * NEVER A SHELL: `spawn(file, args, { shell: false })` — every argument reaches the tool as one
 * argv element, so nothing an operator typed is ever parsed by a shell. The child's environment
 * is EXACTLY the one given (never `process.env`, which holds the database password, the KMS
 * master key and every other secret of this process); the SSH password, when there is one,
 * reaches sshpass only as its `SSHPASS` variable, never as an argument (argv is world-readable
 * in `/proc` and `ps`).
 *
 * Bounded: a timeout (SIGTERM, then SIGKILL after a grace period), an abort signal (cancel), and
 * a cap on the output kept in memory (the tail is kept: rsync's summary is at the end).
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "child_process";

/** What a run answers. */
export interface ProcessResult {
  /** The exit code, or null when the process was ended by a signal. */
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  /** The process could not be started at all (the tool is not installed: ENOENT). */
  spawnError: string | null;
}

/** One run's input. */
export interface ProcessSpec {
  file: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  cwd?: string | undefined;
  /** Each stdout chunk, as it arrives (rsync's progress lines). */
  onStdout?: ((chunk: string) => void) | undefined;
}

/** The spawn the runner uses; a test replaces it with `setSpawn`. */
type Spawn = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

let spawnImpl: Spawn = nodeSpawn;

/** Replace the spawn function (tests); returns the previous one. */
export const setSpawn = (fn: Spawn): Spawn => {
  const previous = spawnImpl;
  spawnImpl = fn;
  return previous;
};

/** The output kept per stream: the last 256 KiB. */
export const MAX_KEPT_OUTPUT = 256 * 1024;

/** How long a process has between SIGTERM and SIGKILL. */
export const KILL_GRACE_MS = 5_000;

const keepTail = (current: string, chunk: string): string => {
  const next = current + chunk;
  return next.length > MAX_KEPT_OUTPUT ? next.slice(next.length - MAX_KEPT_OUTPUT) : next;
};

/**
 * Run `spec.file` with `spec.args`. Never rejects: every outcome (exit, signal, timeout, abort,
 * a tool that is not installed) is a resolved ProcessResult.
 */
export const runProcess = (spec: ProcessSpec): Promise<ProcessResult> =>
  new Promise<ProcessResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const child = spawnImpl(spec.file, spec.args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...spec.env },
      ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
    });

    const stop = (): void => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, KILL_GRACE_MS);
      killTimer.unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, spec.timeoutMs);
    timer.unref();

    const onAbort = (): void => {
      aborted = true;
      stop();
    };
    if (spec.signal) {
      if (spec.signal.aborted) {
        onAbort();
      } else {
        spec.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const finish = (result: Omit<ProcessResult, "stdout" | "stderr" | "timedOut" | "aborted">): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      spec.signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, stdout, stderr, timedOut, aborted });
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = keepTail(stdout, chunk);
      spec.onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = keepTail(stderr, chunk);
    });
    child.on("error", (err: Error) => {
      finish({ code: null, signal: null, spawnError: (err as NodeJS.ErrnoException).code ?? err.message });
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish({ code, signal, spawnError: null });
    });
  });
