/**
 * A-19 — the opt-in pre-push hook (scripts/git-hooks/pre-push), exercised for
 * real: each case builds a scratch git repository, copies in the hook and the
 * repository's .gitleaks.toml, and runs the hook with the stdin git gives it
 * (`<local ref> <local sha> <remote ref> <remote sha>` per line).
 *
 * The hook's own logic is tested with a stub `gitleaks` placed in the scratch
 * repository's .tools/bin — which also proves the hook puts the copy that
 * `make hooks` installs first on its PATH. Detection itself is tested with the
 * REAL gitleaks, which every place that runs the suite must have: `make hooks`
 * (scripts/git-hooks/install-gitleaks.sh) puts the pinned, checksum-verified
 * binary in .tools/bin, and CI's backend-test job runs that installer. Without
 * it that case FAILS, naming the command; it is never skipped (2026-10-10).
 * The "no gitleaks anywhere" case removes every gitleaks from the hook's PATH
 * itself, so it runs on a machine that has one installed too.
 *
 * The secret committed to the scratch repository is generated at run time, so
 * no secret-shaped string exists in this file for the repository scan to find.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

// Each case spawns several git and bash processes; on Windows that is seconds.
jest.setTimeout(60000);

const ROOT = path.resolve(__dirname, "../../../..");
const HOOK = path.join(ROOT, "scripts/git-hooks/pre-push");
const ZERO = "0".repeat(40);

const GIT_ENV = {
  GIT_AUTHOR_NAME: "a19",
  GIT_AUTHOR_EMAIL: "a19@example.invalid",
  GIT_COMMITTER_NAME: "a19",
  GIT_COMMITTER_EMAIL: "a19@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

const run = (cmd, args, opts = {}) => {
  const env = { ...process.env, ...GIT_ENV };
  if (opts.env && "PATH" in opts.env) {
    // Windows spells it Path: keep one spelling, or the child may read the other.
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") {
        delete env[key];
      }
    }
  }
  return spawnSync(cmd, args, { encoding: "utf8", ...opts, env: { ...env, ...(opts.env || {}) } });
};

/** This process's PATH without any directory that holds a gitleaks binary. */
const pathWithoutGitleaks = () => {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
  return (key ? process.env[key] : "")
    .split(path.delimiter)
    .filter((dir) => dir && !["gitleaks", "gitleaks.exe"].some((name) => fs.existsSync(path.join(dir, name))))
    .join(path.delimiter);
};

const git = (cwd, ...args) => {
  const r = run("git", args, { cwd });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout.trim();
};

/** The real gitleaks, if make hooks installed one or it is on the PATH. */
const realGitleaks = () => {
  for (const name of ["gitleaks", "gitleaks.exe"]) {
    const local = path.join(ROOT, ".tools/bin", name);
    if (fs.existsSync(local)) {
      return local;
    }
  }
  const r = run("bash", ["-c", "command -v gitleaks"]);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
};
const REAL_GITLEAKS = realGitleaks();

let repo;
let base;

/** A fresh scratch repository with one clean commit. */
const scratchRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a19-hook-"));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  fs.copyFileSync(path.join(ROOT, ".gitleaks.toml"), path.join(dir, ".gitleaks.toml"));
  fs.writeFileSync(path.join(dir, "README.md"), "scratch\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, sha: git(dir, "rev-parse", "HEAD") };
};

const commitFile = (dir, file, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", `add ${file}`);
  return git(dir, "rev-parse", "HEAD");
};

/** A stub gitleaks in <repo>/.tools/bin that records its argv and exits `code`. */
const stubGitleaks = (dir, code) => {
  const bin = path.join(dir, ".tools/bin");
  fs.mkdirSync(bin, { recursive: true });
  const stub = path.join(bin, "gitleaks");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${path.join(dir, "gitleaks.args").split(path.sep).join("/")}"\nexit ${code}\n`,
  );
  fs.chmodSync(stub, 0o755);
};

const pushLine = (localSha, remoteSha) => `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`;

const runHook = (dir, input, env = {}) =>
  run("bash", [HOOK.split(path.sep).join("/"), "origin", "file:///nowhere"], {
    cwd: dir,
    input,
    env,
  });

beforeEach(() => {
  ({ dir: repo, sha: base } = scratchRepo());
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("A-19: pre-push hook", () => {
  it("refuses the push (exit 1) when gitleaks reports a finding, scanning exactly the pushed range", () => {
    stubGitleaks(repo, 1);
    const head = commitFile(repo, "notes.txt", "hello\n");

    const r = runHook(repo, pushLine(head, base));

    expect(r.status).toBe(1);
    expect(r.stdout).toContain("SECRET FOUND in the commits being pushed");
    expect(r.stdout).toContain("push refused");
    const args = fs.readFileSync(path.join(repo, "gitleaks.args"), "utf8").split("\n");
    expect(args).toEqual(
      expect.arrayContaining(["git", "--config", ".gitleaks.toml", "--redact", `--log-opts=${base}..${head}`]),
    );
  });

  it("lets a clean push through (exit 0)", () => {
    stubGitleaks(repo, 0);
    const head = commitFile(repo, "notes.txt", "hello\n");

    const r = runHook(repo, pushLine(head, base));

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[pre-push]");
    expect(r.stdout).toMatch(/ok\s*$/);
  });

  it("scans a new branch as everything not already on a remote", () => {
    stubGitleaks(repo, 0);
    const head = commitFile(repo, "notes.txt", "hello\n");

    expect(runHook(repo, pushLine(head, ZERO)).status).toBe(0);
    const args = fs.readFileSync(path.join(repo, "gitleaks.args"), "utf8");
    expect(args).toContain(`--log-opts=${head} --not --remotes`);
  });

  it("does nothing for a branch delete or for empty input", () => {
    stubGitleaks(repo, 1); // would refuse, if it were called

    expect(runHook(repo, pushLine(ZERO, base)).status).toBe(0);
    expect(runHook(repo, "").status).toBe(0);
    expect(runHook(repo, "\n").status).toBe(0);
    expect(fs.existsSync(path.join(repo, "gitleaks.args"))).toBe(false);
  });

  it("with no gitleaks anywhere, SKIPS the secret scan loudly rather than passing silently", () => {
    // The hook's environment, not the machine's: every PATH directory holding a gitleaks
    // is removed, and the scratch repository has no .tools/bin.
    const env = { PATH: pathWithoutGitleaks() };
    const probe = run("bash", ["-c", "command -v gitleaks; command -v git >/dev/null && echo git-ok"], { env });
    expect(probe.stdout.trim()).toBe("git-ok");
    const head = commitFile(repo, "notes.txt", "hello\n");

    const r = runHook(repo, pushLine(head, base), env);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("SKIP secret scan: gitleaks is not installed");
  });

  it(
    "with the real gitleaks: a pushed commit carrying an AWS access key is refused; the clean range before it is not",
    () => {
      if (!REAL_GITLEAKS) {
        throw new Error(
          "gitleaks is not installed: run `bash scripts/git-hooks/install-gitleaks.sh` (or `make hooks`) from the repository root",
        );
      }
      const bin = path.join(repo, ".tools/bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.copyFileSync(REAL_GITLEAKS, path.join(bin, path.basename(REAL_GITLEAKS)));
      fs.chmodSync(path.join(bin, path.basename(REAL_GITLEAKS)), 0o755);

      const clean = commitFile(repo, "notes.txt", "hello\n");
      expect(runHook(repo, pushLine(clean, base)).status).toBe(0);

      // Generated here: 16 characters of the AWS key alphabet after the prefix.
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      const body = Array.from(crypto.randomBytes(16), (b) => alphabet[b % 32]).join("");
      const leaked = commitFile(repo, "config/deploy.ini", `aws_access_key_id = ${"AKIA"}${body}\n`);

      const r = runHook(repo, pushLine(leaked, clean));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("SECRET FOUND");
      expect(`${r.stdout}${r.stderr}`).not.toContain(body); // --redact
    },
  );
});

describe("A-19: make hooks installs the hook and a pinned gitleaks", () => {
  const makefile = fs.readFileSync(path.join(ROOT, "Makefile"), "utf8");
  const installer = fs.readFileSync(path.join(ROOT, "scripts/git-hooks/install-gitleaks.sh"), "utf8");
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

  it("make hooks points core.hooksPath at scripts/git-hooks and runs the installer", () => {
    const recipe = makefile.split(/\r?\n/).reduce(
      (acc, line) => {
        if (/^hooks:/.test(line)) {
          return { on: true, lines: [] };
        }
        if (acc.on && /^\t/.test(line)) {
          acc.lines.push(line.trim());
        } else if (acc.on && line.trim() !== "") {
          acc.on = false;
        }
        return acc;
      },
      { on: false, lines: [] },
    ).lines;
    expect(recipe).toContain("git config core.hooksPath scripts/git-hooks");
    expect(recipe.some((l) => l.includes("bash scripts/git-hooks/install-gitleaks.sh"))).toBe(true);
  });

  it("the hook puts the installed .tools/bin first on its PATH, and .tools/ is git-ignored", () => {
    expect(fs.readFileSync(HOOK, "utf8")).toMatch(/^PATH="\$PWD\/\.tools\/bin:\$PATH"/m);
    expect(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toMatch(/^\.tools\/\r?$/m);
  });

  it("the installer pins the same gitleaks version and linux_x64 checksum as CI", () => {
    const ciVersion = ci.match(/gitleaks\/releases\/download\/v([\d.]+)\/gitleaks_[\d.]+_linux_x64\.tar\.gz/);
    const ciSum = ci.match(/echo "([0-9a-f]{64})\s+gitleaks\.tgz"/);
    expect(ciVersion && ciSum).toBeTruthy();
    expect(installer).toContain(`VERSION=${ciVersion[1]}`);
    expect(installer).toContain(
      `gitleaks_${ciVersion[1]}_linux_x64.tar.gz) sum=${ciSum[1]}`,
    );
  });

  it("the installer refuses a checksum mismatch before installing anything", () => {
    const verify = installer.indexOf("CHECKSUM MISMATCH");
    const install = installer.indexOf("install -m 0755");
    expect(verify).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(verify);
  });

  it("the committed hook is executable (mode 100755), so a Linux or macOS clone can run it", () => {
    const r = run("git", ["ls-files", "-s", "scripts/git-hooks/pre-push"], { cwd: ROOT });
    expect(r.stdout).toMatch(/^100755 /);
  });
});
