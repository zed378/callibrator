/**
 * A-367 — every live suite is run by `npm run test:live` (CI's `live-db` job); since 2026-10-10
 * none of them can skip (MEMORY/records/2026-10-10-no-skip-live-suites.md).
 *
 * WHY. The `*.live.test.*` suites need a database or a broker. They used to gate themselves
 * (`X_LIVE_TEST=1 ? describe : describe.skip`), so the unit job reported ~50 of them as skipped,
 * and four were found failing on 2026-10-08 because nothing ran them
 * (MEMORY/records/2026-10-08-live-suites-repair.md). Now the unit configuration never loads one,
 * jest.live.config.js loads only them, scripts/live-suites.ts runs every one, and a live suite
 * RUNS and FAILS when its service is missing. This guard holds each half of that.
 */
import * as fs from "fs";
import * as path from "path";

import { SERVICES, SUITES, parseWith } from "../../../scripts/live-suites";

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

/** A skip or a gate that turns into one: `.skip`, `.todo`, `xit`/`xdescribe`, or `? describe : …` / `? it : …`. */
const SKIP_SHAPES = /\b(?:describe|it|test)\.(?:skip|todo)\b|\bx(?:it|describe|test)\(|\?\s*(?:describe|it|test)\s*:|:\s*(?:describe|it|test)\.skip\b/;

interface JestConfig {
  testMatch: string[];
  testPathIgnorePatterns: string[];
  collectCoverage: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the jest configurations are CommonJS tool files outside src/
const unitConfig = require("../../../jest.config.js") as JestConfig;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as above
const liveConfig = require("../../../jest.live.config.js") as JestConfig;

/** Whether a configuration's ignore patterns exclude a path (jest matches them as regular expressions). */
const ignored = (config: JestConfig, file: string): boolean => config.testPathIgnorePatterns.some((p) => new RegExp(p).test(file));

describe("A-367 — the live suites are all run, and none can skip", () => {
  const run = new Set(SUITES.map((s) => s.file));

  it("every live suite file is in the runner's manifest", () => {
    const files = liveFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => !run.has(f))).toEqual([]);
  });

  it("every listed file exists (a rename or deletion fails here)", () => {
    expect([...run].filter((f) => !fs.existsSync(path.join(BACKEND, f)))).toEqual([]);
  });

  it("ids are unique and safe in a database name; no suite carries an opt-in flag; every need is a known service", () => {
    const ids = SUITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SUITES) {
      expect(s.id).toMatch(/^[a-z0-9]{1,20}$/);
      expect(Object.keys(s.env ?? {}).filter((k) => k.endsWith("_TEST"))).toEqual([]);
      expect((s.needs ?? []).filter((n) => !(n in SERVICES))).toEqual([]);
    }
    expect([...parseWith(["all"])].sort()).toEqual(Object.keys(SERVICES).sort());
    expect(() => parseWith(["nope"])).toThrow(/unknown --with=nope/);
  });

  it("no live suite skips: no .skip/.todo, no x-prefixed block, no `? describe : …` gate, no *_LIVE_TEST flag", () => {
    const offenders = liveFiles().filter((f) => {
      const text = fs.readFileSync(path.join(BACKEND, f), "utf8");
      return SKIP_SHAPES.test(text) || /\b[A-Z0-9]+(?:_[A-Z0-9]+)*_LIVE_TEST\b/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("the unit configuration never loads a live suite, and the live configuration loads only them", () => {
    for (const f of liveFiles()) {
      expect([f, ignored(unitConfig, f)]).toEqual([f, true]);
      expect([f, ignored(liveConfig, f)]).toEqual([f, false]);
    }
    expect(ignored(unitConfig, "src/tests/services/batchJob.service.test.js")).toBe(false);
    expect(liveConfig.testMatch.every((m) => m.includes(".live.test."))).toBe(true);
    expect(liveConfig.collectCoverage).toBe(false);
  });

  it("fails on a planted unlisted live suite and on a planted gate (the checks can fail)", () => {
    const planted = "src/tests/services/planted.x.live.test.ts";
    expect([...liveFiles(), planted].filter((f) => !run.has(f))).toEqual([planted]);
    expect(SKIP_SHAPES.test('const live = env("X") === "1" ? describe : describe.skip;')).toBe(true);
    expect(SKIP_SHAPES.test('const live = ENDPOINT === "" ? describe.skip : describe;')).toBe(true);
    expect(SKIP_SHAPES.test('(withClamAv ? it : it.skip)("ClamAV", () => {});')).toBe(true);
    expect(SKIP_SHAPES.test("xit(\"a\", () => {});")).toBe(true);
    expect(SKIP_SHAPES.test('describe("a", () => { it("b", () => {}); });')).toBe(false);
  });
});
