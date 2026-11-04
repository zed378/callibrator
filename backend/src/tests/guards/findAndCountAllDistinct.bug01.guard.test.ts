/**
 * BUG-01 (the 2026-11 audit) — a `findAndCountAll` with an `include` counts
 * DISTINCT roots.
 *
 * Without `distinct: true`, Sequelize counts the JOINED rows. Through a hasMany
 * or belongsToMany include, one root becomes several rows, so `meta.total` and
 * `totalPages` overstate what a client can page through. The audit found this
 * in 19 calls; each now carries `distinct: true`. This guard reads every
 * `findAndCountAll(...)` under src/ (tests excluded) with the TypeScript parser
 * and fails on one whose options object names `include` without `distinct`.
 *
 * An options argument the parser cannot read (a variable, or a spread) is
 * reviewed by hand and listed in REVIEWED with its reason. A listed entry that
 * no longer exists fails too, so the list cannot go stale.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const SRC = path.join(__dirname, "../..");

/** Calls whose options are not a plain object literal, each read by hand (file: reason). */
const REVIEWED: Readonly<Record<string, string>> = {
  "services/eSignature.service.ts":
    "getSignatureHistory spreads an `options` object it builds itself: order, limit, offset and, for a non-manager, attributes; no include",
};

interface Finding {
  file: string;
  line: number;
  kind: "include-without-distinct" | "unreadable";
}

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

const scan = (): Finding[] => {
  const findings: Finding[] = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("findAndCountAll")) {
      continue;
    }
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "findAndCountAll"
      ) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const options = node.arguments[0];
        if (options === undefined || !ts.isObjectLiteralExpression(options)) {
          findings.push({ file: rel, line, kind: "unreadable" });
        } else {
          const names = new Set<string>();
          let spread = false;
          for (const property of options.properties) {
            if (ts.isSpreadAssignment(property)) {
              spread = true;
            } else {
              names.add(property.name.getText(sf));
            }
          }
          if (names.has("include") && !names.has("distinct")) {
            findings.push({ file: rel, line, kind: "include-without-distinct" });
          } else if (spread && !names.has("distinct")) {
            findings.push({ file: rel, line, kind: "unreadable" });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
};

describe("BUG-01 — findAndCountAll with an include counts distinct roots", () => {
  const findings = scan();

  it("no findAndCountAll names an include without distinct: true", () => {
    expect(findings.filter((f) => f.kind === "include-without-distinct")).toEqual([]);
  });

  it("every call the parser cannot read is reviewed by hand, with its reason", () => {
    const unreviewed = findings.filter((f) => f.kind === "unreadable" && !(f.file in REVIEWED));
    expect(unreviewed).toEqual([]);
  });

  it("no reviewed entry is stale: each file still has an unreadable call", () => {
    const unreadable = new Set(findings.filter((f) => f.kind === "unreadable").map((f) => f.file));
    expect(Object.keys(REVIEWED).filter((file) => !unreadable.has(file))).toEqual([]);
  });

  it("the guard is not vacuous: it reads the calls BUG-01 fixed", () => {
    const text = fs.readFileSync(path.join(SRC, "services/stock.service.ts"), "utf8");
    expect(text.match(/findAndCountAll\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sourceFiles().length).toBeGreaterThan(400);
  });
});
