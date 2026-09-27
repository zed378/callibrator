/**
 * P9-01b / ADR-087 — assemble `dist/`, the tree `pkg` packages.
 *
 *   npm run build:dist      (tsx scripts/build-dist.ts)
 *
 * During the migration the backend is part JavaScript, part TypeScript. The
 * binary is built from ONE tree in which every module is JavaScript:
 *
 *   1. dist/index.js and dist/src/ are removed (the pkg binaries that
 *      `npm run build` writes into dist/ are left alone);
 *   2. every unconverted file — index.js and src/** except the tests and the
 *      .ts sources — is COPIED into dist/ byte for byte. tsc is never asked to
 *      re-emit JavaScript: it re-prints it and, under `strict`, prefixes
 *      "use strict", which changes sloppy-mode semantics (ADR-038 rule 3);
 *   3. `tsc -p tsconfig.build.json` compiles the .ts sources into the same
 *      places, next to the copies. That config has `allowJs: false`, so a .ts
 *      file importing an unconverted .js one fails here (rule 1).
 *
 * A module present as both x.js and x.ts is refused: which one a `require`
 * resolves to would depend on the resolver, and the two can disagree (jest
 * tries .js first, tsx .ts).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const BACKEND = path.resolve(__dirname, "..");
const SRC = path.join(BACKEND, "src");
const DIST = path.join(BACKEND, "dist");
const SKIPPED_DIRS = new Set([path.join(SRC, "tests")]);

interface Walked {
  readonly copied: string[];
  readonly typescript: string[];
}

const isTypeScript = (file: string): boolean => file.endsWith(".ts");

function walk(dir: string, out: Walked): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(full)) {
        walk(full, out);
      }
    } else if (isTypeScript(full)) {
      if (!full.endsWith(".d.ts")) {
        out.typescript.push(full);
      }
    } else {
      out.copied.push(full);
    }
  }
}

/**
 * The `tsc` launcher of the backend's own `typescript` devDependency. TypeScript
 * 7's package `exports` hide `bin/`, so the path is read from its manifest.
 */
function tscEntry(): string {
  const manifestPath = require.resolve("typescript/package.json", { paths: [BACKEND] });
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bin =
    typeof manifest === "object" && manifest !== null && "bin" in manifest ? manifest.bin : undefined;
  const entry =
    typeof bin === "object" && bin !== null && "tsc" in bin && typeof bin.tsc === "string" ? bin.tsc : undefined;
  if (entry === undefined) {
    fail(`${manifestPath} declares no bin.tsc`);
  }
  return path.join(path.dirname(manifestPath), entry);
}

function fail(message: string): never {
  process.stderr.write(`build-dist: ${message}\n`);
  process.exit(1);
}

function main(): void {
  fs.rmSync(path.join(DIST, "index.js"), { force: true });
  fs.rmSync(path.join(DIST, "src"), { recursive: true, force: true });

  const walked: Walked = { copied: [], typescript: [] };
  walk(SRC, walked);

  const doubled = walked.typescript.filter((file) =>
    fs.existsSync(file.replace(/\.ts$/, ".js")),
  );
  if (doubled.length > 0) {
    fail(
      "a module exists as both .js and .ts — delete the .js half of each:\n  " +
        doubled.map((file) => path.relative(BACKEND, file)).join("\n  "),
    );
  }

  for (const file of [path.join(BACKEND, "index.js"), ...walked.copied]) {
    const target = path.join(DIST, path.relative(BACKEND, file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }

  if (walked.typescript.length > 0) {
    const tsc = spawnSync(process.execPath, [tscEntry(), "-p", path.join(BACKEND, "tsconfig.build.json")], {
      cwd: BACKEND,
      stdio: "inherit",
    });
    if (tsc.status !== 0) {
      fail(`tsc -p tsconfig.build.json exited ${String(tsc.status)}`);
    }
  }

  const missing = walked.typescript.filter(
    (file) => !fs.existsSync(path.join(DIST, path.relative(BACKEND, file)).replace(/\.ts$/, ".js")),
  );
  if (missing.length > 0) {
    fail(
      "tsc emitted nothing for:\n  " +
        missing.map((file) => path.relative(BACKEND, file)).join("\n  "),
    );
  }

  process.stdout.write(
    `build-dist: ${String(walked.copied.length + 1)} JavaScript files copied, ` +
      `${String(walked.typescript.length)} TypeScript files compiled -> dist/\n`,
  );
}

main();
