#!/usr/bin/env node
/**
 * npm audit gate for the WHOLE tree, dev dependencies included (ADR-117).
 *
 * CI runs two audits:
 *   1. `npm audit --omit=dev --audit-level=high` — the production tree. Strict:
 *      any high or critical advisory fails, nothing can be excused.
 *   2. this script — the whole tree (the lint, build and test toolchain runs in CI
 *      and in the image builder). A high or critical advisory fails unless
 *      scripts/ci/npm-audit-allowlist.json excuses its GHSA id, and an entry only
 *      excuses while ALL of these hold:
 *        - it has not expired (`expires`, YYYY-MM-DD, compared with today in UTC);
 *        - the advisory is absent from the production tree (`--omit=dev`);
 *        - it names the package the advisory is reported against.
 *      An entry whose advisory is no longer reported is printed as stale (a
 *      warning), so the list cannot quietly grow.
 *
 *   node scripts/ci/npm-audit-gate.js
 *   node scripts/ci/npm-audit-gate.js --full a.json --prod b.json --today 2026-10-05
 *        (saved `npm audit --json` reports and a fixed date: how the gate is tested)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST = path.join(__dirname, "npm-audit-allowlist.json");
const FAILING = new Set(["high", "critical"]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function audit(extra) {
  // npm audit exits 1 when it finds anything; the JSON on stdout is what counts.
  try {
    return JSON.parse(
      // A fixed command line (the only arguments are this file's constants), so the
      // shell resolves npm on Windows (npm.cmd) and Linux alike.
      execSync(["npm audit --json", ...extra].join(" "), {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

function load(file, extra) {
  return file ? JSON.parse(fs.readFileSync(file, "utf8")) : audit(extra);
}

/** Every high/critical advisory in a report: Map<GHSA id, {package, severity, title, url}>. */
function advisories(report) {
  if (!report || typeof report.vulnerabilities !== "object") {
    throw new Error(`not an npm audit v2 report: ${JSON.stringify(report).slice(0, 300)}`);
  }
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via !== "object" || !FAILING.has(via.severity)) continue;
      const id = (String(via.url || "").match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/) || [String(via.source)])[0];
      found.set(id, { package: via.name, severity: via.severity, title: via.title, url: via.url });
    }
  }
  return found;
}

function main() {
  const today = arg("--today") || new Date().toISOString().slice(0, 10);
  const full = advisories(load(arg("--full"), []));
  const prod = advisories(load(arg("--prod"), ["--omit=dev"]));
  const entries = new Map(JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).advisories.map((e) => [e.id, e]));

  const failures = [];
  for (const [id, adv] of full) {
    const entry = entries.get(id);
    const label = `${id} ${adv.severity} ${adv.package}: ${adv.title}`;
    if (!entry) failures.push(`${label} — not allow-listed`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires || "")) failures.push(`${label} — allow-list entry has no valid "expires"`);
    else if (entry.expires <= today) failures.push(`${label} — allow-list entry expired ${entry.expires}: review it`);
    else if (prod.has(id)) failures.push(`${label} — reaches the PRODUCTION tree; an allow-list entry cannot excuse that`);
    else if (entry.package !== adv.package) failures.push(`${label} — allow-list entry names "${entry.package}"`);
    else console.log(`allowed  ${label} (dev only, expires ${entry.expires})`);
  }
  for (const id of entries.keys()) {
    if (!full.has(id)) console.log(`::warning::npm audit allow-list entry ${id} is stale (no longer reported) — remove it`);
  }
  for (const f of failures) console.log(`::error::npm audit: ${f}`);
  console.log(`npm audit gate: ${full.size} high/critical advisory(ies), ${failures.length} failing, production tree ${prod.size}.`);
  process.exitCode = failures.length ? 1 : 0;
}

main();
