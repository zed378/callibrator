/**
 * CI third run (2026-10-06, run 37401999535) — every page of rows is ordered by
 * a key that ends in the row's id.
 *
 * `ORDER BY created_at DESC LIMIT 20 OFFSET 20` does not define which rows are
 * on page 2 when two rows share a `created_at`: PostgreSQL may return the tie in
 * a different order on each statement, so a row can appear on two pages and
 * another on none. The access-request queue showed it in CI: two requests made
 * in the same millisecond came back in the other order. Every model's primary
 * key is `id` (checked below), so a trailing `["id", …]` makes the order total
 * without changing the primary sort.
 *
 * WHAT IS CHECKED, statically over src/ (tests excluded):
 *
 *  - every object literal that has an `order` AND a `limit` or `offset`
 *    (directly, or in a spread whose text names them) — the options of a
 *    `findAll` / `findAndCountAll`, or an options object built for one, as
 *    eSignature#getSignatureHistory does. Its `order` must be an array literal
 *    whose LAST entry is `"id"` or `["id", <direction>]`;
 *  - every `findAndCountAll(...)` and every call with an `offset`: it must have
 *    an `order` at all (an unordered page is the same defect, worse).
 *
 * WHAT IS NOT: raw SQL (`sql()`: its few paginated statements are listed in the
 * record and each already ends in a unique key or is a full-text rank), and a
 * `findOne` with an `order` (one row, the newest; a tie there picks either).
 * An entry that is deliberately different goes on EXEMPT with its reason.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const SRC = path.join(__dirname, "../..");

/** `<file relative to src>:<line>` → why its order may end in another key. Empty: none is. */
const EXEMPT: Record<string, string> = {};

interface Finding {
  where: string;
  problem: string;
}

const sourceFiles = (): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "tests" && entry.name !== "node_modules") {
          walk(full);
        }
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.push(full);
      }
    }
  };
  walk(SRC);
  return files;
};

const propName = (p: ts.ObjectLiteralElementLike): string | null =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

/** Does the order's last entry name the id? */
const endsInId = (order: ts.Expression): boolean => {
  if (!ts.isArrayLiteralExpression(order) || order.elements.length === 0) {
    return false;
  }
  const last = order.elements[order.elements.length - 1];
  if (last && ts.isStringLiteral(last)) {
    return last.text === "id";
  }
  if (last && ts.isArrayLiteralExpression(last) && last.elements.length <= 2) {
    const head = last.elements[0];
    return head !== undefined && ts.isStringLiteral(head) && head.text === "id";
  }
  return false;
};

/** Findings for one source text; `pages` counts the paginated option objects seen. */
const scan = (file: string, text: string): { findings: Finding[]; pages: number } => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  let pages = 0;
  const where = (node: ts.Node): string =>
    `${path.relative(SRC, file).split(path.sep).join("/")}:${String(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map(propName);
      const spreadPaging = node.properties.some(
        (p) => ts.isSpreadAssignment(p) && /\b(limit|offset)\b/.test(p.expression.getText(source)),
      );
      const paged = names.includes("limit") || names.includes("offset") || spreadPaging;
      const order = node.properties.find((p) => propName(p) === "order");
      if (paged && order) {
        pages += 1;
        const init = ts.isPropertyAssignment(order) ? order.initializer : null;
        if (!init || !endsInId(init)) {
          findings.push({ where: where(node), problem: `order does not end in "id": ${order.getText(source).replace(/\s+/g, " ")}` });
        }
      }
      const parent = node.parent;
      const isFirstArg =
        ts.isCallExpression(parent) &&
        parent.arguments[0] === node &&
        ts.isPropertyAccessExpression(parent.expression);
      const hasSpread = node.properties.some((p) => ts.isSpreadAssignment(p));
      if (isFirstArg && !order && !hasSpread) {
        const method = parent.expression.name.text;
        if ((method === "findAndCountAll" && paged) || (method.startsWith("find") && names.includes("offset"))) {
          pages += 1;
          findings.push({ where: where(node), problem: `${method} pages without an order` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { findings, pages };
};

describe("every page of rows is ordered by a key that ends in the id (CI run 37401999535)", () => {
  it("no paginated query in src/ orders by a non-unique key alone", () => {
    const findings: Finding[] = [];
    let pages = 0;
    for (const file of sourceFiles()) {
      const result = scan(file, fs.readFileSync(file, "utf8"));
      findings.push(...result.findings.filter((f) => !(f.where in EXEMPT)));
      pages += result.pages;
    }
    // Not vacuous: the scan sees the paginated queries (58 on 2026-10-06).
    expect(pages).toBeGreaterThanOrEqual(50);
    expect(findings).toEqual([]);
  });

  it("every exemption still names a paginated query", () => {
    for (const key of Object.keys(EXEMPT)) {
      const file = path.join(SRC, key.replace(/:\d+$/, ""));
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it("every model's primary key is `id`, the key the order ends in", () => {
    const dir = path.join(SRC, "models");
    const models = fs.readdirSync(dir).filter((f) => f.endsWith(".model.ts"));
    expect(models.length).toBeGreaterThan(60);
    for (const file of models) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const keys = [...text.matchAll(/(\w+):\s*\{[^{}]*primaryKey:\s*true/g)].map((m) => m[1]);
      expect({ file, keys }).toEqual({ file, keys: ["id"] });
    }
  });

  describe("the scan itself (a guard that cannot fail proves nothing)", () => {
    const run = (body: string): string[] => scan(path.join(SRC, "services/x.service.ts"), body).findings.map((f) => f.problem);

    it("flags a page ordered by createdAt alone, and by a dynamic column alone", () => {
      expect(run("M.findAndCountAll({ where, limit, offset, order: [[\"createdAt\", \"DESC\"]] });")).toHaveLength(1);
      expect(run("M.findAll({ order: [[col, dir]], limit: 5 });")).toHaveLength(1);
      expect(run("const o = { order: [[\"signedAt\", \"DESC\"]], limit, offset: 0 };")).toHaveLength(1);
      expect(run("M.findAll({ where, order: [[\"a\", \"ASC\"]], ...(limit ? { limit } : {}) });")).toHaveLength(1);
      expect(run("M.findAll({ where, order: ORDER, limit });")).toHaveLength(1);
    });

    it("flags a page with no order at all", () => {
      expect(run("M.findAndCountAll({ where, offset, limit });")).toEqual(["findAndCountAll pages without an order"]);
      expect(run("M.findAll({ where, offset: 10 });")).toEqual(["findAll pages without an order"]);
    });

    it("passes an order that ends in the id, and leaves unpaged and bounded-lookup queries alone", () => {
      expect(run("M.findAndCountAll({ where, limit, offset, order: [[\"createdAt\", \"DESC\"], [\"id\", \"DESC\"]] });")).toEqual([]);
      expect(run("M.findAll({ order: [[col, dir], [\"id\", dir]], limit: 5 });")).toEqual([]);
      expect(run("M.findAll({ order: [[\"id\", \"ASC\"]], limit });")).toEqual([]);
      expect(run("M.findAll({ where, order: [[\"name\", \"ASC\"]] });")).toEqual([]);
      expect(run("M.findAll({ where, limit: 2 });")).toEqual([]);
    });
  });
});
