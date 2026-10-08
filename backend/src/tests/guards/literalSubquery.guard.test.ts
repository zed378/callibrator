/**
 * P21-09d — G-15 (threat model AM-10, hardening): no Sequelize `literal(...)` subquery in
 * application source.
 *
 * A `literal("(SELECT … FROM …)")` inside an `attributes`, `where` or `order` is SQL the hooks
 * never see: it carries neither the tenant nor the facility predicate, and a bound principal's
 * list would count or read another facility's rows through it. A subquery belongs in a hooked
 * query (an include, a second find) or in `sql()` with both predicates bound (G-14).
 *
 * Textual: every `literal(` / `.literal(` call whose argument text contains SELECT is refused.
 * There are none today; the bite case below plants one.
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "../..");
const SCANNED_DIRS = ["services", "controllers", "utils", "middlewares", "models", "routes"];

const sourceFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  for (const dir of SCANNED_DIRS) {
    walk(path.join(SRC, dir));
  }
  return out;
};

/** `literal(` calls (not `z.literal(`) whose first 400 characters of argument name a SELECT. */
const subqueriesIn = (source: string): string[] => {
  const out: string[] = [];
  const re = /(?:^|[^\w$.]|(?:Sequelize|sequelize|db)\.)literal\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const before = source.slice(Math.max(0, match.index - 2), match.index + 1);
    if (before.endsWith("z.")) {continue;}
    const arg = source.slice(match.index + match[0].length, match.index + match[0].length + 400);
    if (/\bSELECT\b/i.test(arg.split(")")[0] ?? "") || /^\s*["'`]\s*\(\s*SELECT\b/i.test(arg)) {
      out.push(arg.slice(0, 60));
    }
  }
  return out;
};

describe("G-15 — no literal() subquery in application source", () => {
  it("none in services, controllers, utils, middlewares, models, routes", () => {
    const hits = sourceFiles()
      .map((full) => ({ file: path.relative(SRC, full).split(path.sep).join("/"), hits: subqueriesIn(fs.readFileSync(full, "utf8")) }))
      .filter((f) => f.hits.length > 0);
    expect(hits).toEqual([]);
  });

  it("bites (fail-before): a planted literal subquery is found; zod's z.literal and a plain literal are not", () => {
    expect(subqueriesIn('attributes: [[literal("(SELECT COUNT(*) FROM certificates c WHERE c.device_id = d.id)"), "n"]]')).toHaveLength(1);
    expect(subqueriesIn('order: [[Sequelize.literal(`(select max(x) from y)`), "DESC"]]')).toHaveLength(1);
    expect(subqueriesIn('status: z.literal("SELECT")')).toHaveLength(0);
    expect(subqueriesIn('where: literal("is_deleted = false")')).toHaveLength(0);
  });
});
