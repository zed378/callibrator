#!/usr/bin/env node
/**
 * Turns a failed backend jest run into GitHub annotations (2026-10-05, ADR-117).
 *
 * The job logs of this public repository need a token to read; the annotations of
 * a check run do not (`GET /repos/<owner>/<repo>/check-runs/<job id>/annotations`).
 * CI run 37268522297 failed `npm run test:coverage` with nothing readable but
 * "Process completed with exit code 1". jest's own `github-actions` reporter
 * (passed on the CI step) annotates a failing TEST, but not a suite that failed to
 * run at all (a load error, a killed worker) and not a missed coverage threshold.
 * This step, run only when the test step failed, covers both:
 *
 *   node scripts/ci/jest-annotate.js <jest --json output> <coverage-summary.json>
 *
 * It prints `::error::` workflow commands. GitHub keeps at most 10 error
 * annotations per step, so the per-suite lines stop at 7 and one summary line names
 * the rest. It always exits 0: it explains a failure, it never decides one.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const MAX_SUITE_ANNOTATIONS = 7;
const MAX_LINES = 12;

/** Escapes a workflow-command message (GitHub's `escapeData`). */
function escapeData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escapes a workflow-command property (GitHub's `escapeProperty`). */
function escapeProperty(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// eslint-disable-next-line no-control-regex -- strips ANSI colour codes from jest's messages
const ANSI = /\u001b\[[0-9;]*m/g;

function firstLines(text, n) {
  return String(text || "")
    .replace(ANSI, "")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(0, n)
    .join("\n");
}

function annotate(title, message, file) {
  const props = [`title=${escapeProperty(title)}`];
  if (file) props.unshift(`file=${escapeProperty(file)}`);
  process.stdout.write(`::error ${props.join(",")}::${escapeData(message)}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { __error: e.message };
  }
}

function suites(resultsFile) {
  const results = readJson(resultsFile);
  if (results.__error) {
    annotate("jest wrote no results", `${resultsFile}: ${results.__error} — jest stopped before it finished (crash, OOM or timeout); read the step log.`);
    return 1;
  }
  const failed = (results.testResults || []).filter((r) => r.status === "failed" || r.testExecError);
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
  failed.forEach((r, i) => {
    const tests = (r.assertionResults || []).filter((a) => a.status === "failed").map((a) => `✕ ${a.fullName}`);
    const reason = r.testExecError ? firstLines(r.testExecError.message || r.testExecError, MAX_LINES) : firstLines(r.message, MAX_LINES);
    const body = [...tests.slice(0, 5), tests.length > 5 ? `… and ${tests.length - 5} more` : null, reason].filter(Boolean).join("\n");
    process.stdout.write(`FAILED ${rel(r.name)}\n${body}\n\n`);
    if (i < MAX_SUITE_ANNOTATIONS) annotate(`jest: ${rel(r.name)}`, body, rel(r.name));
  });
  const summary =
    `${results.numFailedTestSuites} suite(s) failed, ${results.numRuntimeErrorTestSuites} could not run; ` +
    `${results.numFailedTests} test(s) failed of ${results.numTotalTests}.` +
    (failed.length ? `\n${failed.map((r) => rel(r.name)).join("\n")}` : "");
  process.stdout.write(`${summary}\n`);
  if (failed.length) annotate("jest: failed suites", summary);
  return failed.length;
}

function coverage(summaryFile) {
  const summary = readJson(summaryFile);
  if (summary.__error) {
    annotate("coverage summary missing", `${summaryFile}: ${summary.__error}`);
    return;
  }
  const metrics = ["statements", "branches", "functions", "lines"];
  const misses = [];
  for (const [file, m] of Object.entries(summary)) {
    if (file === "total") continue;
    const below = metrics.filter((k) => m[k] && m[k].pct < 100);
    if (below.length) {
      misses.push(`${path.relative(ROOT, file).split(path.sep).join("/")}: ${below.map((k) => `${k} ${m[k].covered}/${m[k].total}`).join(", ")}`);
    }
  }
  const total = summary.total || {};
  const totals = metrics.map((k) => (total[k] ? `${k} ${total[k].pct}%` : `${k} ?`)).join(" · ");
  process.stdout.write(`coverage total: ${totals}\n${misses.join("\n")}\n`);
  if (misses.length) {
    annotate(
      `coverage below 100% in ${misses.length} file(s)`,
      `total: ${totals}\n${misses.slice(0, 30).join("\n")}${misses.length > 30 ? `\n… and ${misses.length - 30} more` : ""}`,
    );
  }
}

const [resultsFile, summaryFile] = process.argv.slice(2);
if (!resultsFile || !summaryFile) {
  process.stderr.write("usage: jest-annotate.js <jest --json output> <coverage-summary.json>\n");
  process.exit(0);
}
suites(resultsFile);
coverage(summaryFile);
