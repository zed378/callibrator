/**
 * P21-09 — G-13 of docs/SECURITY/15 § 11 (spec MEMORY/specs/P19-04-client-facilities.md § 7.6):
 * every `skipFacilityScope: true` in src/ is reviewed.
 *
 * A `skipFacilityScope` is a place where the facility hooks do nothing for a bound principal —
 * held only by review (ADR-124 Am. 1, implications). So each use must:
 *  - sit in a function named in FACILITY_SCOPE_SKIPS (`"<file under src>#<function>"`), with a reason;
 *  - carry a `// skipFacilityScope: <reason>` comment right above it;
 * and every FACILITY_SCOPE_SKIPS entry must still have a use (a stale entry is an unreviewed hole
 * waiting to be filled).
 *
 * HOW: every non-test source file is parsed with the TypeScript parser; each property assignment
 * `skipFacilityScope: true` is a use, named by its innermost NAMED function (a variable holding an
 * arrow function, a function declaration, a method). Include-level uses count the same.
 *
 * Fail-before: the `bites` cases plant an unlisted use and a use without its comment.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { FACILITY_SCOPE_SKIPS } from "../../constants/facilityAccess";

const SRC = path.join(__dirname, "../..");

const sourceFiles = (): string[] =>
  (fs.readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => path.join(SRC, f))
    .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"))
    .filter((f) => !f.includes(`${path.sep}tests${path.sep}`));

/** The innermost named function around `n`, or `<module>`. */
const functionName = (n: ts.Node, source: ts.SourceFile): string => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent as ts.Node | undefined) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) {
      return p.name.getText(source);
    }
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent)) {
      return p.parent.name.getText(source);
    }
  }
  return "<module>";
};

/** Every use in `text`: its key, whether the comment above it is there. */
const usesIn = (relative: string, text: string): { key: string; commented: boolean; line: number }[] => {
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const lines = text.split(/\r?\n/);
  const out: { key: string; commented: boolean; line: number }[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(source) === "skipFacilityScope" &&
      n.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      const line = source.getLineAndCharacterOfPosition(n.getStart(source)).line;
      // The comment may span lines: look up the contiguous `//` block right above the use.
      let commented = false;
      for (let i = line - 1; i >= 0 && /^\s*\/\//.test(lines[i] ?? ""); i--) {
        if (/\/\/\s*skipFacilityScope:\s*\S/.test(lines[i] ?? "")) {
          commented = true;
        }
      }
      out.push({ key: `${relative}#${functionName(n, source)}`, commented, line: line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return out;
};

const allUses = (): { key: string; commented: boolean; line: number }[] =>
  sourceFiles().flatMap((file) => usesIn(path.relative(SRC, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")));

describe("G-13 — every skipFacilityScope is reviewed", () => {
  const uses = allUses();

  it("finds the reviewed uses (the walk works)", () => {
    expect(uses.length).toBeGreaterThan(0);
  });

  it("every use is in a function FACILITY_SCOPE_SKIPS names, with a reason", () => {
    const unlisted = uses.filter((u) => !(u.key in FACILITY_SCOPE_SKIPS)).map((u) => `${u.key}:${String(u.line)}`);
    expect(unlisted).toEqual([]);
    for (const reason of Object.values(FACILITY_SCOPE_SKIPS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("every use carries its `// skipFacilityScope: <reason>` comment", () => {
    expect(uses.filter((u) => !u.commented).map((u) => `${u.key}:${String(u.line)}`)).toEqual([]);
  });

  it("every FACILITY_SCOPE_SKIPS entry still has a use", () => {
    const used = new Set(uses.map((u) => u.key));
    expect(Object.keys(FACILITY_SCOPE_SKIPS).filter((k) => !used.has(k))).toEqual([]);
  });

  it("bites: an unlisted use and an uncommented one are found", () => {
    const planted = usesIn(
      "services/planted.service.ts",
      [
        "export const leak = async () => {",
        "  // skipFacilityScope: planted",
        "  await Device.findAll({ skipFacilityScope: true });",
        "};",
        "function bare() { return Device.findAll({ include: [{ model: Vendor, skipFacilityScope: true }] }); }",
        "const x = { skipFacilityScope: false };",
      ].join("\n"),
    );
    expect(planted.map((u) => [u.key, u.commented])).toEqual([
      ["services/planted.service.ts#leak", true],
      ["services/planted.service.ts#bare", false],
    ]);
    expect(planted.some((u) => u.key in FACILITY_SCOPE_SKIPS)).toBe(false);
  });

  it("names a module-level use `<module>`", () => {
    expect(usesIn("x.ts", "const o = { skipFacilityScope: true };").map((u) => u.key)).toEqual(["x.ts#<module>"]);
    expect(usesIn("x.ts", "export default { skipFacilityScope: true };").map((u) => u.key)).toEqual(["x.ts#<module>"]);
  });
});
