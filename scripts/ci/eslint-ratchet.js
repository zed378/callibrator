#!/usr/bin/env node
/**
 * ESLint ratchet for the backend (P7-01).
 *
 * The backend lint gate had never run (A-34). It runs now and reports about
 * 1,100 errors — almost all formatting that `--fix` would rewrite, which is
 * P9-02a's job and a diff nobody can review inside another change. A pipeline
 * that runs plain `eslint` is therefore red on day one, and the pressure on a
 * red required stage is `continue-on-error` — the abuse case P7-01 names.
 *
 * So this stage FAILS when the error count goes UP, and when it goes DOWN
 * without the baseline being lowered with it (so the ratchet only ever turns
 * one way, and a fixed error cannot silently come back). It is a real gate:
 * a change that adds a lint error is red.
 *
 *   node scripts/ci/eslint-ratchet.js           check against the baseline
 *   node scripts/ci/eslint-ratchet.js --update  write the current count
 *
 * The baseline is backend/.eslint-baseline.json. When P9-02a lands it is 0
 * and this script can be replaced by plain `eslint --max-warnings=…`.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(ROOT, "backend");
const BASELINE = path.join(BACKEND, ".eslint-baseline.json");

async function main() {
  const { ESLint } = require(require.resolve("eslint", { paths: [BACKEND, ROOT] }));
  const eslint = new ESLint({ cwd: BACKEND });
  const results = await eslint.lintFiles(["src/"]);

  const errors = results.reduce((n, r) => n + r.errorCount, 0);
  const warnings = results.reduce((n, r) => n + r.warningCount, 0);
  const byFile = results
    .filter((r) => r.errorCount > 0)
    .map((r) => ({ file: path.relative(BACKEND, r.filePath), errors: r.errorCount }))
    .sort((a, b) => b.errors - a.errors);

  if (process.argv.includes("--update")) {
    fs.writeFileSync(
      BASELINE,
      `${JSON.stringify({ errors, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`,
    );
    console.log(`Baseline written: ${errors} error(s), ${warnings} warning(s).`);
    return 0;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).errors;
  console.log(`backend eslint: ${errors} error(s), ${warnings} warning(s); baseline ${baseline}.`);

  if (errors > baseline) {
    console.error(`\nFAIL: ${errors - baseline} NEW lint error(s). Files with errors, most first:`);
    for (const { file, errors: n } of byFile.slice(0, 25)) {
      console.error(`  ${String(n).padStart(4)}  ${file}`);
    }
    console.error("\nRun `npx eslint <file>` in backend/ on the files you changed.");
    return 1;
  }
  if (errors < baseline) {
    console.error(
      `\nFAIL: the error count fell to ${errors}. Lock the gain in:\n` +
        "  node scripts/ci/eslint-ratchet.js --update   and commit backend/.eslint-baseline.json",
    );
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`eslint-ratchet crashed: ${err.stack || err.message}`);
    // A crash is a FAILURE. A-34 was a crashing ESLint read as success.
    process.exit(2);
  },
);
