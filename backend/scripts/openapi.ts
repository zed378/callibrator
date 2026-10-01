/**
 * P9-25 (ADR-103) — the OpenAPI contract, as npm scripts.
 *
 *   npm run openapi:generate   write backend/openapi.json (commit it)
 *   npm run openapi:check      fail when the committed openapi.json is not what the source generates
 *   npm run openapi:lint       Spectral, with backend/.spectral.yaml
 *   npm run openapi:breaking   oasdiff: breaking changes against the base branch's openapi.json
 *
 * `openapi:breaking` needs the `oasdiff` binary on PATH (CI installs it,
 * checksum-verified). Locally, without it, the script says so and exits 0 with
 * a clear "SKIPPED" — it never reports a pass it did not run. The base defaults
 * to `origin/main`; set OPENAPI_BASE_REF to compare against another ref. A base
 * without an openapi.json (the first P9-25 commit) is reported and skipped.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../src/config/env";
import { OPENAPI_FILE, buildDocument, isCurrent, serialise } from "./openapi/build";

const BACKEND = path.resolve(__dirname, "..");
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

const version = (): string => (JSON.parse(fs.readFileSync(path.join(BACKEND, "package.json"), "utf8")) as { version: string }).version;

const fresh = (): string => serialise(buildDocument({ version: version() }));

const generate = (): void => {
  const text = fresh();
  fs.writeFileSync(OPENAPI_FILE, text);
  const doc = JSON.parse(text) as { paths: Record<string, Record<string, { "x-source"?: string }>> };
  const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods));
  const codeFirst = operations.filter((op) => op["x-source"]?.startsWith("code-first")).length;
  out(`openapi: wrote ${path.relative(BACKEND, OPENAPI_FILE)} — ${String(operations.length)} operations, ${String(codeFirst)} code-first`);
};

const check = (): void => {
  if (!fs.existsSync(OPENAPI_FILE)) {
    fail("openapi: backend/openapi.json is missing — run `npm run openapi:generate` and commit it");
  }
  if (!isCurrent(fs.readFileSync(OPENAPI_FILE, "utf8"), fresh())) {
    fail(
      "openapi: backend/openapi.json is STALE — the routes' JSDoc or *.openapi.ts changed without regenerating.\n" +
        "        Run `npm run openapi:generate` and commit the result with the change.",
    );
  }
  out("openapi: backend/openapi.json is current");
};

const run = (command: string, args: string[]): number => {
  const result = spawnSync(command, args, { cwd: BACKEND, stdio: "inherit" });
  return result.status ?? 1;
};

/** Spectral's JSON result, the fields read here. `severity` 0 is an error. */
interface SpectralResult {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly severity: number;
  readonly message: string;
}

/**
 * The Spectral ERRORS the legacy JSDoc half had when P9-25 landed, pinned as
 * "rule json.path". Like P6-08's KNOWN_DRIFT the list may only shrink: a new
 * error fails, and a fixed one must be deleted from the file. An error in a
 * code-first operation is never baselined.
 */
const SPECTRAL_BASELINE = path.join(BACKEND, "openapi.spectral-baseline.json");

const lint = (): void => {
  const spectral = path.join(BACKEND, "..", "node_modules", "@stoplight", "spectral-cli", "dist", "index.js");
  const report = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "spectral-")), "report.json");
  run(process.execPath, [
    spectral, "lint", OPENAPI_FILE,
    "--ruleset", path.join(BACKEND, ".spectral.yaml"),
    "--format", "json", "--output", report, "--quiet",
  ]);
  if (!fs.existsSync(report)) {
    fail("openapi: Spectral did not run (no report written)");
  }
  const results = JSON.parse(fs.readFileSync(report, "utf8")) as SpectralResult[];
  const errors = results.filter((r) => r.severity === 0);
  const warnings = results.length - errors.length;
  const keyOf = (r: SpectralResult): string => `${r.code} ${r.path.join(".")}`;
  const doc = JSON.parse(fs.readFileSync(OPENAPI_FILE, "utf8")) as { paths: Record<string, Record<string, unknown>> };
  const isCodeFirst = (r: SpectralResult): boolean => {
    if (r.path[0] !== "paths" || r.path.length < 3) {
      return false;
    }
    const op = doc.paths[String(r.path[1])]?.[String(r.path[2])] as { "x-source"?: string } | undefined;
    return op?.["x-source"]?.startsWith("code-first") ?? false;
  };
  const baseline = new Set(
    fs.existsSync(SPECTRAL_BASELINE) ? (JSON.parse(fs.readFileSync(SPECTRAL_BASELINE, "utf8")) as string[]) : [],
  );
  if (process.argv.includes("--write-baseline")) {
    const legacy = [...new Set(errors.filter((r) => !isCodeFirst(r)).map(keyOf))].sort();
    fs.writeFileSync(SPECTRAL_BASELINE, `${JSON.stringify(legacy, null, 2)}
`);
    out(`openapi: wrote ${String(legacy.length)} legacy errors to ${path.relative(BACKEND, SPECTRAL_BASELINE)}`);
    return;
  }
  const found = new Set(errors.map(keyOf));
  const fresh = errors.filter((r) => isCodeFirst(r) || !baseline.has(keyOf(r)));
  const fixed = [...baseline].filter((k) => !found.has(k));
  for (const r of fresh) {
    process.stderr.write(`  error  ${r.code}  ${r.path.join(".")}
         ${r.message}
`);
  }
  for (const k of fixed) {
    process.stderr.write(`  fixed  ${k}  (delete it from openapi.spectral-baseline.json)
`);
  }
  if (fresh.length > 0 || fixed.length > 0) {
    fail(`openapi: Spectral — ${String(fresh.length)} new error(s), ${String(fixed.length)} stale baseline entr(ies)`);
  }
  out(
    `openapi: Spectral — no new error; ${String(baseline.size)} baselined legacy error(s), ${String(warnings)} warning(s) ` +
      "(npx spectral lint openapi.json --ruleset .spectral.yaml lists them)",
  );
};

const breaking = (): void => {
  const probe = spawnSync("oasdiff", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    out(
      "openapi:breaking SKIPPED — the `oasdiff` binary is not on PATH. CI runs this check " +
        "(.github/workflows/ci.yml); locally install oasdiff (https://github.com/oasdiff/oasdiff) to run it.",
    );
    return;
  }
  const ref = env("OPENAPI_BASE_REF") ?? "origin/main";
  const shown = spawnSync("git", ["show", `${ref}:backend/openapi.json`], { cwd: BACKEND, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (shown.status !== 0) {
    out(`openapi:breaking SKIPPED — ${ref} has no backend/openapi.json yet (the contract's first commit)`);
    return;
  }
  const base = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openapi-base-")), "openapi.json");
  fs.writeFileSync(base, shown.stdout);
  const status = run("oasdiff", ["breaking", base, OPENAPI_FILE, "--fail-on", "ERR"]);
  if (status !== 0) {
    fail(
      `openapi: BREAKING change against ${ref} (above). A published contract is not broken silently: ` +
        "make the change additive, or record the break (ADR + deprecation note) before merging.",
    );
  }
  out(`openapi: no breaking change against ${ref}`);
};

const commands: Record<string, () => void> = { generate, check, lint, breaking };
const command = process.argv[2] ?? "generate";
const selected = commands[command];
if (selected === undefined) {
  fail(`openapi: unknown command "${command}" — one of ${Object.keys(commands).join(", ")}`);
} else {
  selected();
}
