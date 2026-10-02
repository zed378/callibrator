/**
 * P9-24 (ADR-109 §5) — no non-test JavaScript in the backend's source.
 *
 * Phase 9 exits when every non-test backend source module is TypeScript. The
 * counted set is the ratchet's, tests excluded: the entry point (`index.*`),
 * `src/**` outside `src/tests/`, and `scripts/**`. The `.js` test files are
 * not part of the exit (P9-26 converts them; the ratchet keeps them
 * shrink-only), so the base tsconfig keeps `allowJs` for them alone.
 *
 * Until the last modules land, PENDING names each remaining source `.js` and
 * who holds it. The guard fails both ways:
 *  - a non-test `.js` that is not listed (a new one, or a conversion undone);
 *  - a listed one that is gone (its conversion landed: delete the entry).
 * When PENDING is empty, the exit item is met and stays met.
 */
import fs from "fs";
import path from "path";

const BACKEND = path.join(__dirname, "..", "..", "..");

/** The source `.js` files still to convert or delete, each with who holds it (2026-10-02). */
const PENDING: readonly string[] = [
  "src/utils/checkMenu.util.js", // dead; deleting it awaits the owner (A-18)
];

/** Every `.js` file under `dir`, relative to the backend root, `/`-separated. */
const jsUnder = (dir: string): string[] =>
  fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true }) as string[])
      .map((f) => path.join(dir, f))
      .filter((f) => f.endsWith(".js") && fs.statSync(f).isFile())
      .map((f) => path.relative(BACKEND, f).split(path.sep).join("/"))
    : [];

const sourceJs = (): string[] =>
  [
    ...(fs.existsSync(path.join(BACKEND, "index.js")) ? ["index.js"] : []),
    ...jsUnder(path.join(BACKEND, "src")).filter((f) => !f.startsWith("src/tests/")),
    ...jsUnder(path.join(BACKEND, "scripts")),
  ].sort();

describe("P9-24 — no non-test JavaScript in backend source", () => {
  it("the scan sees the source tree (a scan that finds nothing to compare is not a pass)", () => {
    expect(fs.existsSync(path.join(BACKEND, "src", "tests"))).toBe(true);
    expect(jsUnder(path.join(BACKEND, "src", "tests")).length).toBeGreaterThan(0);
  });

  it("every non-test .js file is a listed pending one, and every listed one still exists", () => {
    expect(sourceJs()).toEqual([...PENDING].sort());
  });

  it("the entry point is TypeScript", () => {
    expect(fs.existsSync(path.join(BACKEND, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(BACKEND, "index.js"))).toBe(false);
  });
});
