/**
 * The rsync image import's conversations with the source host: scan its host keys, list a class
 * folder (`rsync --dry-run --stats`: proves the login, the path and readability, and estimates
 * files and bytes, using only rsync's own server on the remote side — no remote command is run),
 * and copy a class folder into the staging quarantine.
 *
 * Every outcome becomes a STABLE CODE (CONNECTION_ERRORS). A tool's own message is never answered
 * or logged: ssh and rsync errors can carry the remote banner, the remote path or the user name.
 */
import path from "path";
import { buildKeyscanArgs, buildRsyncArgs, buildSshCommand, childEnv, knownHostsLine, remoteSpec, rsyncCommand, sshCommandString } from "./sshArgs";
import { parseKeyscan, type ScannedHostKey } from "./hostKeys";
import { runProcess, type ProcessResult } from "./processRunner";
import type { RunScratch } from "./workspace";
import type { UpstreamAuthMethod } from "../../constants/upstreamFileImport";

/** The stable outcome codes of a connection step. */
export const CONNECTION_ERRORS = Object.freeze([
  "tool_missing", // rsync / ssh / sshpass / ssh-keyscan is not installed in this image
  "unreachable", // refused, no route, DNS at the ssh level, or no key offered
  "timeout",
  "host_key_mismatch", // the server did not present the confirmed key
  "auth_failed",
  "path_not_found",
  "path_not_readable",
  "cancelled",
  "transfer_failed", // any other rsync failure
] as const);
export type ConnectionError = (typeof CONNECTION_ERRORS)[number];

/** Everything a step needs to log in. The password exists only in this object, in memory. */
export interface SessionInput {
  address: string;
  port: number;
  username: string;
  authMethod: UpstreamAuthMethod;
  password?: string | null | undefined;
  privateKey?: string | null | undefined;
  pinned: { type: string; key: string };
}

/**
 * A path as one word of rsync's `-e` string: forward slashes (on Linux, where the import runs,
 * this changes nothing; a Windows development machine's backslashes would read as escapes).
 */
const slashes = (file: string): string => file.split(path.sep).join("/");

/** A prepared login: the ssh `-e` string and the child's environment. */
export interface Session {
  input: SessionInput;
  sshCommand: string;
  env: Record<string, string>;
}

/**
 * Write the pinned known_hosts (and the private key, for key auth) into the run's scratch and
 * build the ssh command. The scratch's `dispose` wipes both.
 */
export const openSession = async (input: SessionInput, scratch: RunScratch, connectTimeoutSec?: number): Promise<Session> => {
  const knownHostsPath = slashes(await scratch.writeSecret("known_hosts", knownHostsLine(input.pinned)));
  let identityPath: string | null = null;
  if (input.authMethod === "key") {
    const key = input.privateKey ?? "";
    identityPath = slashes(await scratch.writeSecret("id_source", key.endsWith("\n") ? key : `${key}\n`));
  }
  const tokens = buildSshCommand({
    port: input.port,
    knownHostsPath,
    hostKeyType: input.pinned.type,
    authMethod: input.authMethod,
    identityPath,
    connectTimeoutSec,
  });
  return {
    input,
    sshCommand: sshCommandString(tokens),
    env: childEnv(scratch.dir, input.authMethod === "password" ? input.password : null),
  };
};

/** The tool behind an ENOENT: every one of them is missing the same way. */
const missing = (result: ProcessResult): boolean => result.spawnError === "ENOENT";

/**
 * Classify a failed ssh/rsync/sshpass run. Ordered: our own stop reasons first, then sshpass's
 * documented exit codes (5 wrong password, 6 host key unknown), then ssh's messages, then rsync's.
 */
export const classifyFailure = (result: ProcessResult): ConnectionError => {
  if (missing(result)) {
    return "tool_missing";
  }
  if (result.aborted) {
    return "cancelled";
  }
  if (result.timedOut) {
    return "timeout";
  }
  const err = result.stderr;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No matching host key|no hostkey alg/i.test(err) || result.code === 6) {
    return "host_key_mismatch";
  }
  if (/Permission denied \((publickey|password|keyboard-interactive)/i.test(err) || /Too many authentication failures/i.test(err) || result.code === 5) {
    return "auth_failed";
  }
  if (/Connection refused|No route to host|Network is unreachable|Could not resolve|Connection timed out|Connection closed|Connection reset/i.test(err)) {
    return "unreachable";
  }
  if (/No such file or directory/i.test(err)) {
    return "path_not_found";
  }
  if (/Permission denied \(13\)|opendir .* failed|failed: Permission denied/i.test(err)) {
    return "path_not_readable";
  }
  return "transfer_failed";
};

/** What a key scan answers. */
export type ScanResult = { ok: true; keys: ScannedHostKey[] } | { ok: false; error: ConnectionError };

/** `ssh-keyscan` the address: its keys of the accepted types. */
export const scanHostKeys = async (address: string, port: number, timeoutMs: number, home: string): Promise<ScanResult> => {
  const timeoutSec = Math.max(1, Math.min(60, Math.floor(timeoutMs / 1000)));
  const result = await runProcess({
    file: "ssh-keyscan",
    args: buildKeyscanArgs(address, port, timeoutSec),
    env: childEnv(home),
    timeoutMs: timeoutMs + 5_000,
  });
  if (missing(result)) {
    return { ok: false, error: "tool_missing" };
  }
  if (result.timedOut) {
    return { ok: false, error: "timeout" };
  }
  const keys = parseKeyscan(result.stdout);
  return keys.length > 0 ? { ok: true, keys } : { ok: false, error: "unreachable" };
};

/** A number rsync printed with thousands separators (`--no-human-readable` still groups in some builds). */
const toInt = (text: string | undefined): number => (text === undefined ? 0 : Number(text.replace(/[,.\s]/g, "")) || 0);

/** Files and bytes from `rsync --stats` (regular files only; directories are not files). */
export const parseStats = (stdout: string): { files: number; bytes: number } => ({
  // "Number of files: 4 (reg: 3, dir: 1)"; a folder holding only directories prints no "reg:".
  files: toInt(/Number of files: [\d,.]+ \(reg: ([\d,.]+)/.exec(stdout)?.[1]),
  bytes: toInt(/Total file size: ([\d,.]+) bytes/.exec(stdout)?.[1]),
});

/** A class folder's listing. */
export type ListResult = { ok: true; files: number; bytes: number } | { ok: false; error: ConnectionError };

/** `rsync --dry-run --stats` of one remote folder into an empty local one. */
export const listRemote = async (
  session: Session,
  remoteDir: string,
  emptyDir: string,
  timeoutMs: number,
  ioTimeoutSec: number,
): Promise<ListResult> => {
  const command = rsyncCommand(
    session.input.authMethod,
    buildRsyncArgs({
      mode: "estimate",
      sshCommand: session.sshCommand,
      source: remoteSpec(session.input.username, session.input.address, remoteDir),
      destination: `${emptyDir}/`,
      ioTimeoutSec,
    }),
  );
  const result = await runProcess({ ...command, env: session.env, timeoutMs });
  if (result.code !== 0) {
    return { ok: false, error: classifyFailure(result) };
  }
  return { ok: true, ...parseStats(result.stdout) };
};

/** Progress a transfer reports. */
export interface TransferProgress {
  bytes: number;
  files: number;
}

/**
 * The last `--info=progress2` line in a chunk: `  1,234,567  45%  1.23MB/s  0:01:02 (xfr#12, to-chk=100/200)`.
 * Answers the bytes so far and the files transferred so far, or null when the chunk has none.
 */
export const parseProgress = (chunk: string): TransferProgress | null => {
  let bytes: number | null = null;
  let files = 0;
  for (const line of chunk.split(/\r?\n|\r/)) {
    const match = /^\s*([\d,.]+)\s+\d+%/.exec(line);
    if (match) {
      bytes = toInt(match[1]);
      const xfr = /xfr#(\d+)/.exec(line);
      files = xfr ? Number(xfr[1]) : files;
    }
  }
  return bytes === null ? null : { bytes, files };
};

/** A class folder's transfer. */
export type TransferResult = { ok: true; files: number; bytes: number } | { ok: false; error: ConnectionError };

/** Copy one remote folder into `localDir` (resumable, bandwidth-limited, cancellable). */
export const transferRemote = async (
  session: Session,
  options: {
    remoteDir: string;
    localDir: string;
    ioTimeoutSec: number;
    timeoutMs: number;
    bandwidthLimitKbps: number | null;
    signal: AbortSignal;
    onProgress: (progress: TransferProgress) => void;
  },
): Promise<TransferResult> => {
  const command = rsyncCommand(
    session.input.authMethod,
    buildRsyncArgs({
      mode: "transfer",
      sshCommand: session.sshCommand,
      source: remoteSpec(session.input.username, session.input.address, options.remoteDir),
      destination: `${options.localDir}/`,
      ioTimeoutSec: options.ioTimeoutSec,
      bandwidthLimitKbps: options.bandwidthLimitKbps,
    }),
  );
  const result = await runProcess({
    ...command,
    env: session.env,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onStdout: (chunk) => {
      const progress = parseProgress(chunk);
      if (progress) {
        options.onProgress(progress);
      }
    },
  });
  if (result.code !== 0) {
    return { ok: false, error: classifyFailure(result) };
  }
  // The final stats: what this run copied (a resumed run copies only what was missing).
  const transferred = /Number of regular files transferred: ([\d,.]+)/.exec(result.stdout)?.[1];
  const bytes = /Total transferred file size: ([\d,.]+) bytes/.exec(result.stdout)?.[1];
  return { ok: true, files: toInt(transferred), bytes: toInt(bytes) };
};
