/**
 * P9-04 (ADR-038 rule 2, ADR-087) — the JavaScript ratchet.
 *
 *   npm run ratchet            check; lowers the floor when files were converted
 *   npm run ratchet -- --list  print the counted files and exit
 *   npm run ratchet -- --init  write the first floor (refuses if one exists)
 *
 * The floor is `backend/.ts-ratchet.json`: the sorted list of every counted
 * `.js` file. The check FAILS when a counted `.js` file exists that the floor
 * does not list — a new JavaScript file, or one renamed. Listing names rather
 * than keeping a number means a conversion elsewhere cannot make room for a
 * new `.js` file: the count may not rise, and no NEW name may appear.
 *
 * When files have gone (converted or deleted) and none is new, the check
 * REWRITES the floor and passes, so the lower floor is committed together with
 * the conversion that earned it (P9-04). Raising the floor by hand is the abuse
 * case the card names: the only way to add a name is to edit the JSON, and that
 * edit is in the diff for review.
 *
 * Counted (what ships, or tests what ships):
 *   backend/index.js, backend/src/**, backend/__tests__/**, backend/scripts/**
 * Not counted, with the reason:
 *   backend-root files other than index.js — jest.config.js, jest.e2e.config.js,
 *                            jest.transform.js, eslint.config.js: tool files
 *                            loaded by jest and eslint as CommonJS, not application code
 *   node_modules, dist, coverage — generated or third-party
 *
 * Migrations are counted like any file. Their manifest names are frozen with
 * the `.js` suffix (P9-23), which decides how they leave the count; until then
 * they sit in the floor and the floor cannot reach zero without P9-23.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const BACKEND = path.resolve(__dirname, "..");
const FLOOR_FILE = path.join(BACKEND, ".ts-ratchet.json");
const COUNTED_ROOTS = ["src", "__tests__", "scripts"] as const;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"]);

interface Floor {
  readonly count: number;
  readonly files: readonly string[];
}

/** Forward-slash path relative to backend/, stable across operating systems. */
const relative = (file: string): string => path.relative(BACKEND, file).split(path.sep).join("/");

function collect(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        collect(full, out);
      }
    } else if (entry.name.endsWith(".js")) {
      out.push(relative(full));
    }
  }
}

function countedFiles(): string[] {
  const out: string[] = [];
  if (fs.existsSync(path.join(BACKEND, "index.js"))) {
    out.push("index.js");
  }
  for (const root of COUNTED_ROOTS) {
    collect(path.join(BACKEND, root), out);
  }
  return out.sort();
}

function readFloor(): Floor {
  const parsed: unknown = JSON.parse(fs.readFileSync(FLOOR_FILE, "utf8"));
  const files =
    typeof parsed === "object" && parsed !== null && "files" in parsed && Array.isArray(parsed.files)
      ? parsed.files.filter((file): file is string => typeof file === "string")
      : undefined;
  if (files === undefined) {
    throw new Error(`${FLOOR_FILE} has no "files" list`);
  }
  return { count: files.length, files };
}

function writeFloor(files: readonly string[]): void {
  const floor: Floor = { count: files.length, files };
  fs.writeFileSync(FLOOR_FILE, `${JSON.stringify(floor, null, 2)}\n`);
}

function main(argv: readonly string[]): number {
  const current = countedFiles();

  if (argv.includes("--list")) {
    process.stdout.write(`${current.join("\n")}\n${String(current.length)} file(s)\n`);
    return 0;
  }
  if (argv.includes("--init")) {
    if (fs.existsSync(FLOOR_FILE)) {
      process.stderr.write("ts-ratchet: the floor already exists; --init writes the first one only\n");
      return 1;
    }
    writeFloor(current);
    process.stdout.write(`ts-ratchet: floor written, ${String(current.length)} .js file(s)\n`);
    return 0;
  }

  const floor = readFloor();
  const known = new Set(floor.files);
  const added = current.filter((file) => !known.has(file));
  const present = new Set(current);
  const removed = floor.files.filter((file) => !present.has(file));

  if (added.length > 0) {
    process.stderr.write(
      `ts-ratchet: FAIL — ${String(added.length)} new .js file(s). New backend code is TypeScript (ADR-038 rule 2):\n  ` +
        added.join("\n  ") +
        "\n",
    );
    return 1;
  }
  if (removed.length > 0) {
    writeFloor(current);
    process.stdout.write(
      `ts-ratchet: floor lowered ${String(floor.count)} -> ${String(current.length)} ` +
        `(${String(removed.length)} .js file(s) gone). Commit backend/.ts-ratchet.json with this change.\n`,
    );
    return 0;
  }
  process.stdout.write(`ts-ratchet: ${String(current.length)} .js file(s), at the floor\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
