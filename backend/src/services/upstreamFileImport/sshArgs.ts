/**
 * The exact argument vectors of every external tool the rsync image import runs. PURE: no I/O,
 * so every vector is held by a test (tests/services/upstreamFileImport/sshArgs.test.ts) — an
 * injection attempt in a host, user or path must never become an option or reach a shell, and
 * the password must never appear in any vector.
 *
 * WHY EACH SSH OPTION (all fixed; none comes from input):
 *   -F /dev/null                 no ssh_config of this host: no ProxyCommand, no Include, no
 *                                LocalCommand an image could carry
 *   StrictHostKeyChecking=yes    only the pinned key is accepted (TOFU confirmed by the operator)
 *   UserKnownHostsFile=<file>    a temporary known_hosts holding exactly that key …
 *   GlobalKnownHostsFile=/dev/null … and nothing else
 *   HostKeyAlias=<alias>         the key is looked up under a fixed alias, so the address dialled
 *                                (resolved and checked by hostGuard) never changes which key applies
 *   HostKeyAlgorithms=<type>     the server must present the confirmed key's type
 *   UpdateHostKeys=no            the server cannot add keys to the pin
 *   BatchMode / auth options     password auth through sshpass, OR key auth, never both and
 *                                never an agent (IdentitiesOnly, IdentityAgent=none)
 *   ProxyCommand=none, ProxyJump=none, ForwardAgent/X11=no, ClearAllForwardings=yes,
 *   PermitLocalCommand=no, Tunnel=no  nothing runs locally and nothing is forwarded
 *   ConnectTimeout, ServerAlive* a dead peer ends the run instead of hanging it
 *
 * rsync's remote side is only ever rsync's own server (`--protect-args`: the path travels inside
 * the rsync protocol, not on a remote command line); `--rsync-path` is never set.
 */
import { HOST_KEY_ALIAS, TRANSFER_MAX_SIZE } from "../../constants/upstreamFileImport";
import type { UpstreamAuthMethod } from "../../constants/upstreamFileImport";

/** A host key the operator confirmed. */
export interface PinnedHostKey {
  type: string;
  key: string;
}

/** What `buildSshCommand` needs. */
export interface SshCommandInput {
  port: number;
  knownHostsPath: string;
  hostKeyType: string;
  authMethod: UpstreamAuthMethod;
  /** The private key file (key auth only). */
  identityPath?: string | null | undefined;
  connectTimeoutSec?: number | undefined;
}

/** The host-key algorithms that accept a key of `type` (an RSA key is offered as SHA-2 signatures). */
export const hostKeyAlgorithmsFor = (type: string): string =>
  type === "ssh-rsa" ? "rsa-sha2-512,rsa-sha2-256" : type;

/** The temporary known_hosts content: exactly one line, the confirmed key under the fixed alias. */
export const knownHostsLine = (pinned: PinnedHostKey): string => `${HOST_KEY_ALIAS} ${pinned.type} ${pinned.key}\n`;

/** A token that rsync's `-e` splitting would read as one word: no whitespace, no quote, no backslash. */
const SAFE_TOKEN = /^[A-Za-z0-9_./=,:@+-]+$/;

/**
 * Join the ssh command into the single `-e` string rsync takes. rsync splits that string on
 * whitespace itself, so every token must be ONE word: a token that is not refuses the whole
 * command (it would be a programming error — no token comes from input).
 */
export const sshCommandString = (tokens: readonly string[]): string => {
  for (const token of tokens) {
    if (!SAFE_TOKEN.test(token)) {
      throw new Error("ssh command token is not a single safe word");
    }
  }
  return tokens.join(" ");
};

/** The ssh invocation (as tokens) rsync uses for its transport. */
export const buildSshCommand = (input: SshCommandInput): string[] => {
  const opt = (value: string): string[] => ["-o", value];
  const common = [
    "ssh",
    "-F",
    "/dev/null",
    "-p",
    String(input.port),
    ...opt("StrictHostKeyChecking=yes"),
    ...opt(`UserKnownHostsFile=${input.knownHostsPath}`),
    ...opt("GlobalKnownHostsFile=/dev/null"),
    ...opt(`HostKeyAlias=${HOST_KEY_ALIAS}`),
    ...opt(`HostKeyAlgorithms=${hostKeyAlgorithmsFor(input.hostKeyType)}`),
    ...opt("UpdateHostKeys=no"),
    ...opt("CheckHostIP=no"),
    ...opt(`ConnectTimeout=${String(input.connectTimeoutSec ?? 15)}`),
    ...opt("ServerAliveInterval=15"),
    ...opt("ServerAliveCountMax=4"),
    ...opt("ProxyCommand=none"),
    ...opt("ProxyJump=none"),
    ...opt("ForwardAgent=no"),
    ...opt("ForwardX11=no"),
    ...opt("ClearAllForwardings=yes"),
    ...opt("PermitLocalCommand=no"),
    ...opt("Tunnel=no"),
    ...opt("IdentitiesOnly=yes"),
    ...opt("IdentityAgent=none"),
    ...opt("LogLevel=ERROR"),
  ];
  if (input.authMethod === "password") {
    // sshpass answers the one password prompt; BatchMode=yes would suppress that prompt.
    return [
      ...common,
      ...opt("BatchMode=no"),
      ...opt("PreferredAuthentications=password,keyboard-interactive"),
      ...opt("PubkeyAuthentication=no"),
      ...opt("NumberOfPasswordPrompts=1"),
    ];
  }
  if (!input.identityPath) {
    throw new Error("key authentication needs an identity file");
  }
  return [
    ...common,
    ...opt("BatchMode=yes"),
    ...opt("PreferredAuthentications=publickey"),
    ...opt("PasswordAuthentication=no"),
    ...opt("KbdInteractiveAuthentication=no"),
    "-i",
    input.identityPath,
  ];
};

/**
 * `user@address:path/` — the source rsync reads. An IPv6 address is bracketed. `username`,
 * `address` and `remoteDir` were validated before they get here (validators/upstreamFileImport.
 * validator.ts); the vector puts this whole spec AFTER `--`, so even a value that slipped through
 * could never be read as an option.
 */
export const remoteSpec = (username: string, address: string, remoteDir: string): string => {
  const host = address.includes(":") ? `[${address}]` : address;
  const dir = remoteDir.endsWith("/") ? remoteDir : `${remoteDir}/`;
  return `${username}@${host}:${dir}`;
};

/** What `buildRsyncArgs` needs. */
export interface RsyncArgsInput {
  mode: "estimate" | "transfer";
  sshCommand: string;
  source: string;
  destination: string;
  ioTimeoutSec: number;
  bandwidthLimitKbps?: number | null | undefined;
  partialDir?: string | undefined;
}

/**
 * The rsync argument vector. Receiving side hardening: no symbolic links, devices or specials
 * are created (`--no-links --no-devices --no-specials`), no owner/group/permission is copied,
 * every file is written 0600 and every directory 0700 (nothing received is executable — the
 * upstream folder holds a shell script, 08 § 10), and nothing above TRANSFER_MAX_SIZE is copied.
 */
export const buildRsyncArgs = (input: RsyncArgsInput): string[] => {
  const args = [
    "--recursive",
    "--protect-args",
    "--no-links",
    "--no-devices",
    "--no-specials",
    "--no-perms",
    "--no-owner",
    "--no-group",
    "--chmod=D700,F600",
    "--times",
    `--max-size=${TRANSFER_MAX_SIZE}`,
    `--timeout=${String(input.ioTimeoutSec)}`,
    "--no-human-readable",
    "--stats",
    "-e",
    input.sshCommand,
  ];
  if (input.mode === "estimate") {
    args.push("--dry-run");
  } else {
    args.push("--partial", `--partial-dir=${input.partialDir ?? ".rsync-partial"}`, "--info=progress2", "--no-inc-recursive");
    if (input.bandwidthLimitKbps) {
      args.push(`--bwlimit=${String(input.bandwidthLimitKbps)}`);
    }
  }
  // `--`: everything after is a path, never an option.
  args.push("--", input.source, input.destination);
  return args;
};

/** `ssh-keyscan` for the address and port: the host's keys of the three accepted types. */
export const buildKeyscanArgs = (address: string, port: number, timeoutSec: number): string[] => [
  "-T",
  String(timeoutSec),
  "-p",
  String(port),
  "-t",
  "ed25519,ecdsa,rsa",
  "--",
  address,
];

/**
 * The command that runs rsync: through sshpass (password read from the `SSHPASS` variable,
 * `-e`), or rsync itself (key auth).
 */
export const rsyncCommand = (authMethod: UpstreamAuthMethod, rsyncArgs: readonly string[]): { file: string; args: string[] } =>
  authMethod === "password" ? { file: "sshpass", args: ["-e", "rsync", ...rsyncArgs] } : { file: "rsync", args: [...rsyncArgs] };

/**
 * The child's whole environment. Built from nothing: never `process.env`. `HOME` is the run's
 * private scratch directory so ssh writes nothing under the service account's home.
 */
export const childEnv = (home: string, password?: string | null): Record<string, string> => ({
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: home,
  LANG: "C",
  LC_ALL: "C",
  ...(password ? { SSHPASS: password } : {}),
});
