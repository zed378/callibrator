/**
 * P9 load gate — every backend module must LOAD, the way production loads it.
 *
 *   npm run load:check            dist/ under plain `node` (the tree pkg packages;
 *                                 run `npm run build:dist` first)
 *   npm run load:check -- --src   src/ under `node --import tsx` (npm start, CI's boot)
 *
 * Why: jest mocks a module's dependencies, and typecheck reads types, so neither
 * executes a module's top level as production does. A module that throws at load
 * (`jsonShape is not defined`, `webauthn_service_module is not defined`, both on
 * 2026-09-30) passed typecheck and 100% coverage and still stopped the backend
 * booting. This gate requires every module in a child process with no mocks:
 *
 *   pass 1  every module under <root>/src (not src/tests, not the src/scripts CLIs,
 *           which run on load), one process, in path order;
 *   pass 2  a FRESH process requiring what index.js requires, in index.js's order,
 *           so a circular-import failure that only the boot order triggers shows.
 *
 * The child gets placeholder configuration: a database and Redis on port 1 (a
 * connection attempt fails at once and nothing is written) and random secrets.
 * Requiring must not need a live service; a module that does is itself a
 * finding. Exit 1 on any module that throws, listing each with its first error.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BACKEND = path.resolve(__dirname, "..");
const useSrc = process.argv.includes("--src");
const ROOT = useSrc ? BACKEND : path.join(BACKEND, "dist");
const MARK = "@@LOADCHECK@@";

interface Failure {
  file: string;
  error: string;
  at: string;
}

const skipped = (rel: string): boolean =>
  /^src[\\/](tests|scripts)[\\/]/.test(rel) || rel.endsWith(".d.ts") || /\.(test|spec)\.[jt]s$/.test(rel);

const modules = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : modules(full);
    }
    const rel = path.relative(ROOT, full);
    const loadable = useSrc ? /\.(js|ts)$/.test(entry.name) : entry.name.endsWith(".js");
    return loadable && !skipped(rel) ? [full] : [];
  });

/** What the entry point requires from ./src, in its order (the boot order). index.ts since P9-21:
 * it keeps index.js's literal `require("./src/...")` calls, in index.js's order, so this reads either. */
const bootOrder = (): string[] => {
  const entry = fs.existsSync(path.join(ROOT, "index.ts")) ? "index.ts" : "index.js";
  const index = fs.readFileSync(path.join(ROOT, entry), "utf8");
  return [...index.matchAll(/require\(\s*["'](\.\/src\/[^"']+)["']\s*\)/g)].map((m) => path.join(ROOT, m[1] as string));
};

// The child: plain CommonJS, so it loads the tree exactly as `node` would.
const CHILD = `
const fs = require("fs");
const NL = String.fromCharCode(10);
const files = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
const failures = [];
for (const file of files) {
  try { require(file); } catch (e) {
    const stack = String((e && e.stack) || "").split(NL);
    failures.push({ file, error: String((e && e.message) || e).split(NL)[0], at: stack.slice(1, 3).map((s) => s.trim()).join(" | ") });
  }
}
process.stdout.write(NL + "${MARK}" + JSON.stringify(failures) + NL);
process.exit(0);
`;

const secret = (): string => randomBytes(32).toString("hex");

const childEnv = (): NodeJS.ProcessEnv => ({
  // eslint-disable-next-line no-restricted-properties -- a build script, not application code: the child inherits PATH/SystemRoot and gets the placeholders below; src/config would validate the real configuration this gate must not need
  ...process.env,
  NODE_ENV: "production",
  DB_HOST: "127.0.0.1",
  DB_PORT: "1",
  DB_NAME: "load_check",
  DB_USER: "load_check",
  DB_PASS: "load_check",
  REDIS_URL: "redis://127.0.0.1:1",
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: "1",
  CERT_SIGNING_SECRET: secret(),
  ENCRYPT_KEY: secret(),
  ATTACHMENT_URL_SECRET: secret(),
  KMS_MASTER_KEY: secret(),
  JWT_ACCESS_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  // P10-05: the public access-request route refuses to load in production
  // without its pepper — a deliberate configuration refusal, not a load defect.
  ACCESS_REQUEST_IP_PEPPER: secret(),
  // ADR-111: in production with billing enabled, stripeWebhook.service refuses
  // to load without a Stripe key. A random value (it authenticates nothing)
  // keeps the gate independent of whether the developer's .env enables billing.
  STRIPE_SECRET_KEY: secret(),
});

const run = (label: string, files: string[]): Failure[] => {
  const list = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "load-check-")), "modules.json");
  fs.writeFileSync(list, JSON.stringify(files));
  const args = [...(useSrc ? ["--import", "tsx"] : []), "-e", CHILD, list];
  const child = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: childEnv(),
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.rmSync(path.dirname(list), { recursive: true, force: true });
  const line = (child.stdout || "").split("\n").find((l) => l.startsWith(MARK));
  if (line === undefined) {
    const tail = `${child.stdout || ""}${child.stderr || ""}`.split("\n").slice(-30).join("\n");
    return [{ file: `(${label})`, error: `the load process ended without a report (status ${String(child.status)}, signal ${String(child.signal)})`, at: tail }];
  }
  process.stdout.write(`load-check: ${label}: ${String(files.length)} modules required\n`);
  return JSON.parse(line.slice(MARK.length)) as Failure[];
};

if (!fs.existsSync(path.join(ROOT, "src"))) {
  process.stderr.write(`load-check: ${ROOT}${path.sep}src does not exist — run \`npm run build:dist\` first\n`);
  process.exit(1);
}

const failures = [...run("every module", modules(path.join(ROOT, "src"))), ...run("boot order (index.ts)", bootOrder())];
if (failures.length > 0) {
  process.stderr.write(`load-check: ${String(failures.length)} module(s) throw at load (${useSrc ? "src via tsx" : "dist via node"}):\n`);
  for (const f of failures) {
    process.stderr.write(`  ${path.relative(ROOT, f.file) || f.file}\n    ${f.error}\n    ${f.at}\n`);
  }
  process.exit(1);
}
process.stdout.write(`load-check: OK (${useSrc ? "src via tsx" : "dist via node"})\n`);
