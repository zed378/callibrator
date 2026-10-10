/**
 * No-skip rule (owner, 2026-10-10) — no test anywhere in the repository may be skipped.
 *
 * WHY
 *
 * A skipped test reports as neither a pass nor a failure. A suite selected away by a condition
 * (an environment variable, a missing binary, the platform) shows up only as a "skipped" count
 * that nobody reads, and the code it covered goes untested while every gate is green. Eight live
 * suites failed unnoticed that way until 2026-10-08 (A-366/A-367).
 *
 * HOW
 *
 * Every JavaScript / TypeScript file under the scanned roots is PARSED (the TypeScript compiler
 * API), not grepped, so a pattern inside a comment or a string does not count and one split
 * across lines does. A file is a hit when its code:
 *  - reads `.skip`, `.todo`, `.fixme` or `.skipIf` off `describe`, `it` or `test`, at any depth
 *    (`describe.skip(`, `it.skip.each(`, `test.describe.skip(`, `test.concurrent.skip(`), called
 *    or not — which is what catches conditional selection: `cond ? describe : describe.skip`,
 *    `(cond ? it : it.skip)(`, `const maybe = cond ? it.skip : it`;
 *  - reads `.skipIf` off anything (vitest's `describe.skipIf(cond)` and its aliases);
 *  - names `xit`, `xdescribe` or `xtest`;
 *  - uses the element form, `describe["skip"]`.
 *
 * LIMITS (stated, not hidden): a test that returns early from its own body, a `testPathIgnore`
 * entry in a jest config, and a jest global re-bound to another name (`const t = test; t.skip`)
 * are not seen. The first is a review item; the second is jest configuration, not test code.
 *
 * The detector is tested at the bottom on planted samples: each pattern above must be flagged,
 * and the look-alikes (a comment, a string, an unrelated `.skip`) must not.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const REPO = path.join(__dirname, "..", "..", "..", "..");

/** The scanned roots, relative to the repository root. */
const ROOTS: readonly string[] = [
  "backend/src",
  "backend/__tests__",
  "frontend/src",
  "packages/contracts",
  "automate",
];

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".next", "build", "out"]);
const EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const JEST_GLOBALS = new Set(["describe", "it", "test"]);
const SKIP_MEMBERS = new Set(["skip", "todo", "fixme", "skipIf"]);
const X_GLOBALS = new Set(["xit", "xdescribe", "xtest"]);

interface Hit {
  line: number;
  text: string;
}

/** The leftmost identifier of a member / call / element chain (`test.describe.skip` → `test`). */
const rootName = (node: ts.Expression): string | null => {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isIdentifier(current)) {return current.text;}
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isCallExpression(current)) {
      current = current.expression;
    } else if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      return null;
    }
  }
};

const memberName = (node: ts.Node): { object: ts.Expression; name: string } | null => {
  if (ts.isPropertyAccessExpression(node)) {return { object: node.expression, name: node.name.text };}
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return { object: node.expression, name: node.argumentExpression.text };
  }
  return null;
};

/** Is this identifier a reference (not a declaration name, a property name or an import alias)? */
const isReference = (id: ts.Identifier): boolean => {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) {return false;}
  if (ts.isPropertyAssignment(parent) && parent.name === id) {return false;}
  if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent)) && parent.name === id) {return false;}
  return true;
};

/** Every skip in `source`, by line. `fileName` only picks the parser's language (JSX or not). */
const findSkips = (source: string, fileName: string): Hit[] => {
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: Hit[] = [];
  const record = (node: ts.Node): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    hits.push({ line: line + 1, text: node.getText(file).replace(/\s+/g, " ").slice(0, 80) });
  };
  const visit = (node: ts.Node): void => {
    const member = memberName(node);
    if (member && SKIP_MEMBERS.has(member.name)) {
      const root = rootName(member.object);
      if (member.name === "skipIf" || (root !== null && JEST_GLOBALS.has(root))) {record(node);}
    } else if (ts.isIdentifier(node) && X_GLOBALS.has(node.text) && isReference(node)) {
      record(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
};

const filesUnder = (dir: string): string[] => {
  if (!fs.existsSync(dir)) {return [];}
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {continue;}
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {out.push(...filesUnder(full));}
    else if (EXTENSIONS.test(entry.name) && !entry.name.endsWith(".d.ts")) {out.push(full);}
  }
  return out;
};

const scanRepository = (): { scanned: Record<string, number>; hits: string[] } => {
  const scanned: Record<string, number> = {};
  const hits: string[] = [];
  for (const root of ROOTS) {
    const files = filesUnder(path.join(REPO, root));
    scanned[root] = files.length;
    for (const file of files) {
      const rel = path.relative(REPO, file).split(path.sep).join("/");
      for (const hit of findSkips(fs.readFileSync(file, "utf8"), file)) {hits.push(`${rel}:${String(hit.line)}  ${hit.text}`);}
    }
  }
  return { scanned, hits };
};

describe("no-skip rule — no skipped, todo or conditionally selected test anywhere", () => {
  const { scanned, hits } = scanRepository();

  it("the scan sees every root (a scan that finds nothing is not a pass)", () => {
    for (const root of ROOTS) {
      expect({ root, files: (scanned[root] ?? 0) > 0 }).toEqual({ root, files: true });
    }
  });

  it("no file skips a test", () => {
    expect(hits).toEqual([]);
  });
});

describe("no-skip rule — the detector, on planted samples", () => {
  const flagged = (code: string, fileName = "sample.test.ts"): boolean => findSkips(code, fileName).length > 0;

  it.each([
    ["describe.skip", "describe.skip(\"a\", () => {});"],
    ["it.skip", "it.skip(\"a\", () => {});"],
    ["test.skip", "test.skip(\"a\", () => {});"],
    ["it.skip.each", "it.skip.each([[1]])(\"a %s\", () => {});"],
    ["describe.skip.each", "describe.skip.each([[1]])(\"a\", () => {});"],
    ["test.concurrent.skip", "test.concurrent.skip(\"a\", async () => {});"],
    ["test.describe.skip (Playwright)", "test.describe.skip(\"a\", () => {});"],
    ["test.fixme (Playwright)", "test.fixme(\"a\", async () => {});"],
    ["test.skip(cond) inside a body (Playwright)", "test(\"a\", async () => { test.skip(process.platform === \"win32\", \"x\"); });"],
    ["xit", "xit(\"a\", () => {});"],
    ["xdescribe", "xdescribe(\"a\", () => {});"],
    ["xtest", "xtest(\"a\", () => {});"],
    ["it.todo", "it.todo(\"later\");"],
    ["test.todo", "test.todo(\"later\");"],
    ["describe.todo", "describe.todo(\"later\");"],
    ["describe.skipIf", "describe.skipIf(!process.env.X)(\"a\", () => {});"],
    ["it.skipIf", "it.skipIf(true)(\"a\", () => {});"],
    ["cond ? describe : describe.skip", "const d = process.env.DB ? describe : describe.skip;\nd(\"a\", () => {});"],
    ["cond ? it.skip : it", "const run = hasBinary ? it.skip : it;"],
    ["(cond ? it : it.skip)(", "(ok ? it : it.skip)(\"a\", () => {});"],
    ["a skip split across lines", "describe\n  .skip(\"a\", () => {});"],
    ["the element form", "describe[\"skip\"](\"a\", () => {});"],
    ["a skip in a .js file", "describe.skip(\"a\", function () {});"],
  ])("flags %s", (_name, code) => {
    expect(flagged(code)).toBe(true);
    expect(flagged(code, "sample.test.js")).toBe(true);
  });

  it("flags a skip in a .tsx file with JSX", () => {
    expect(flagged("it.skip(\"renders\", () => { render(<div />); });", "Page.test.tsx")).toBe(true);
  });

  it("reports the line of each hit", () => {
    expect(findSkips("describe(\"a\", () => {\n  it(\"b\", () => {});\n  it.skip(\"c\", () => {});\n});", "s.test.ts").map((h) => h.line)).toEqual([3]);
  });

  it.each([
    ["a plain suite", "describe(\"a\", () => { it(\"b\", () => {}); test(\"c\", () => {}); });"],
    ["each", "it.each([[1]])(\"a %s\", () => {});"],
    ["a skip named in a comment", "// never use describe.skip here\n/* it.skip(\"a\") */\nit(\"a\", () => {});"],
    ["a skip named in a string", "const why = \"it.skip is refused\"; it(why, () => {});"],
    ["an unrelated .skip", "const page = query.skip(10).limit(5); stream.skip(1);"],
    ["a property named todo", "const list = { todo: [] }; list.todo.push(1);"],
    ["a property named xit", "const o = { xit: 1 }; o.xit += 1;"],
  ])("does not flag %s", (_name, code) => {
    expect(flagged(code)).toBe(false);
  });
});
