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

import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "..", "..");
// 30 on 2026-09-28 (P9-03a): lowered to the count, and the scan now reads .ts
// too — a converted file carries its directives into TypeScript (ADR-092).
const CEILING = 30;

interface DirectiveHit {
    file: string;
    line: number;
    text: string;
}

const listSource = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : listSource(full);
    }
    return /\.(js|ts)$/.test(entry.name) ? [full] : [];
  });

const directives: DirectiveHit[] = listSource(SRC).flatMap((file) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => ({ file: path.relative(SRC, file), line: i + 1, text: line }))
    .filter(({ text }) => text.includes("istanbul ignore")),
);

describe("A-32 — istanbul ignore directives", () => {
  it("the scan found the tree (a scan that finds nothing is not a pass)", () => {
    expect(directives.length).toBeGreaterThan(0);
  });

  it("every directive states why: `istanbul ignore <kind> -- <reason>`", () => {
    const unexplained = directives
      .filter(({ text }) => !/istanbul ignore (next|if|else|file)\s+--\s+\S/.test(text))
      .map(({ file, line, text }) => `${file}:${String(line)} ${text.trim()}`);
    expect(unexplained).toEqual([]);
  });

  it("the count does not rise above " + String(CEILING), () => {
    expect(directives.length).toBeLessThanOrEqual(CEILING);
  });
});
