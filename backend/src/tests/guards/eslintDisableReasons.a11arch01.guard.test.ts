/**
 * A11-ARCH-01 (the 2026-11 audit) — every `eslint-disable` in source says why.
 *
 * docs/ENGINEERING/04 asks for a reason on every `eslint-disable`; ESLint's
 * own `-- description` is where it goes. The audit counted the suppressions
 * and asked which ones still earn their place. Two halves of that answer are
 * mechanical:
 *  - an UNUSED directive is a lint warning (ESLint 9 reports them by default,
 *    and the ratchet runs at 0 warnings), so every directive left suppresses a
 *    real report;
 *  - a directive WITHOUT a reason cannot be reviewed. This guard fails on one.
 *
 * Source only (src/, tests excluded): the converted tests are on their own
 * frozen list (ADR-092 Am. 1).
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "../..");

const sourceFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "tests") {
          walk(full);
        }
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
};

/** `eslint-disable`, `-line` and `-next-line` directives; `eslint-enable` closes and needs no reason. */
const DIRECTIVE = /eslint-disable(?:-next-line|-line)?\b([^\n*]*)/g;

describe("A11-ARCH-01 — every eslint-disable in source carries a reason", () => {
  const files = sourceFiles();

  it("reads the source tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it("no directive lacks a `-- reason`", () => {
    const bare: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const match of line.matchAll(DIRECTIVE)) {
          if (!(match[1] ?? "").includes(" -- ")) {
            bare.push(`${path.relative(SRC, file).split(path.sep).join("/")}:${String(i + 1)}`);
          }
        }
      });
    }
    expect(bare).toEqual([]);
  });
});
