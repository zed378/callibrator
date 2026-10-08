/**
 * A-367 — every live suite is run by `npm run test:live` (CI's `live-db` job), or is on its
 * reviewed list of by-hand suites.
 *
 * WHY. The `*.live.test.*` suites are opt-in and need a database, so the unit job skips them. Four
 * were found failing on 2026-10-08, one of them for every case since 2026-10-05, because nothing
 * ran them (MEMORY/records/2026-10-08-live-suites-repair.md). scripts/live-suites.ts runs them; a
 * new live suite that is in neither of its lists would be skipped again, silently — this fails.
 */
import * as fs from "fs";
import * as path from "path";

import { NOT_RUN, SUITES } from "../../../scripts/live-suites";

const BACKEND = path.resolve(__dirname, "../../..");

/** Every `*.live.test.{js,ts}` under the given roots, relative to backend/, with forward slashes. */
const liveFiles = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.live\.test\.(js|ts)$/.test(entry.name)) {
        found.push(path.relative(BACKEND, full).split(path.sep).join("/"));
      }
    }
  };
  for (const root of ["src", "__tests__"]) {
    const dir = path.join(BACKEND, root);
    if (fs.existsSync(dir)) {
      walk(dir);
    }
  }
  return found.sort();
};

describe("A-367 — the live suites are all accounted for", () => {
  const run = new Set(SUITES.map((s) => s.file));

  it("every live suite file is run by test:live or listed as by-hand, never both", () => {
    const files = liveFiles();
    expect(files.length).toBeGreaterThan(30);
    const unaccounted = files.filter((f) => !run.has(f) && !NOT_RUN.includes(f));
    expect(unaccounted).toEqual([]);
    expect(NOT_RUN.filter((f) => run.has(f))).toEqual([]);
  });

  it("every listed file exists (a rename or deletion fails here)", () => {
    const missing = [...run, ...NOT_RUN].filter((f) => !fs.existsSync(path.join(BACKEND, f)));
    expect(missing).toEqual([]);
  });

  it("ids are unique and safe in a database name; every suite opts in", () => {
    const ids = SUITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SUITES) {
      expect(s.id).toMatch(/^[a-z0-9]{1,20}$/);
      expect(Object.entries(s.env).some(([k, v]) => k.endsWith("_TEST") && v === "1")).toBe(true);
    }
  });

  it("fails on a planted unlisted live suite (the check can fail)", () => {
    const planted = "src/tests/services/planted.x.live.test.ts";
    const files = [...liveFiles(), planted];
    expect(files.filter((f) => !run.has(f) && !NOT_RUN.includes(f))).toEqual([planted]);
  });
});
