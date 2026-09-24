/**
 * A-32 — the 100 % coverage figure is only as honest as its exclusions.
 *
 * On 2026-09-23 there were 58 `istanbul ignore` directives in backend/src, 31
 * with no reason, several over code described as unreachable (dead code kept
 * and hidden). On 2026-09-24 the count was 43; this change removed 12 by
 * deleting the unreachable code they hid (see the A-32 comments at each site)
 * and gave every remaining one a reason.
 *
 * Two rules, enforced here so a new directive is reviewed like a new
 * `eslint-disable`:
 *   1. every directive carries a reason: `istanbul ignore <kind> -- <why>`;
 *   2. the count never rises above the ceiling below. Lower it when you remove
 *      one; raising it is a reviewed decision, not a drive-by.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..");
const CEILING = 31;

const listJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : listJs(full);
    }
    return entry.name.endsWith(".js") ? [full] : [];
  });

const directives = listJs(SRC).flatMap((file) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => ({ file: path.relative(SRC, file), line: i + 1, text: line }))
    .filter(({ text }) => /istanbul ignore/.test(text)),
);

describe("A-32 — istanbul ignore directives", () => {
  it("the scan found the tree (a scan that finds nothing is not a pass)", () => {
    expect(directives.length).toBeGreaterThan(0);
  });

  it("every directive states why: `istanbul ignore <kind> -- <reason>`", () => {
    const unexplained = directives
      .filter(({ text }) => !/istanbul ignore (next|if|else|file)\s+--\s+\S/.test(text))
      .map(({ file, line, text }) => `${file}:${line} ${text.trim()}`);
    expect(unexplained).toEqual([]);
  });

  it(`the count does not rise above ${CEILING}`, () => {
    expect(directives.length).toBeLessThanOrEqual(CEILING);
  });
});
