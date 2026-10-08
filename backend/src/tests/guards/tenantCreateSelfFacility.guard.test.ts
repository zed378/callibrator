/**
 * P20-07 (ADR-124 Am. 2 § 4; spec MEMORY/specs/P19-04-client-facilities.md § 4.3) — no path that
 * creates a tenant forgets its self facility.
 *
 * Every tenant has exactly one `is_self` client facility: migration 0117 gave one to every tenant
 * that existed, and since then each creation path calls
 * services/clientFacility.service#createSelfFacility (explicit and audited — a database trigger
 * was rejected). A tenant without one cannot take a device written without a facility (0118's
 * default trigger refuses with 23502), so a forgotten call is a broken tenant.
 *
 * HOW: every non-test source file under src/ is parsed with the TypeScript parser; every call
 * `Tenant.create(`, `Tenants.create(`, `Tenant.findOrCreate(`, `Tenants.findOrCreate(`,
 * `Tenant.bulkCreate(`, `Tenants.bulkCreate(`, `Tenant.upsert(`, `Tenants.upsert(` and every
 * string holding `INSERT INTO tenants` is a creation site; the innermost function around it must
 * also call `createSelfFacility(`. Migrations are outside it by design: 0117 itself back-fills
 * every tenant an earlier migration (0034's PLATFORM) inserted, and runs after them.
 *
 * Fail-before: `sitesWithout` is shown to bite on a planted source (the `bites` case).
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const SRC = path.join(__dirname, "../..");
const CREATE_CALL = /^(Tenants?)\.(create|findOrCreate|bulkCreate|upsert)$/;
const INSERT_TENANT = /INSERT\s+INTO\s+"?tenants"?\b/i;

const sourceFiles = (): string[] =>
  (fs.readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => path.join(SRC, f))
    .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"))
    .filter((f) => !f.includes(`${path.sep}tests${path.sep}`) && !f.includes(`${path.sep}migrations${path.sep}`));

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFunction = (n: ts.Node): n is FunctionNode =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** The creation sites of `text` whose innermost enclosing function never calls createSelfFacility. */
const sitesWithout = (file: string, text: string): { sites: string[]; missing: string[] } => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sites: string[] = [];
  const missing: string[] = [];
  const where = (n: ts.Node): string => `${file}:${String(source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1)}`;
  const enclosing = (n: ts.Node): ts.Node => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent as ts.Node | undefined) {
      if (isFunction(p)) {
        return p;
      }
    }
    return source;
  };
  const check = (n: ts.Node): void => {
    sites.push(where(n));
    if (!enclosing(n).getText(source).includes("createSelfFacility(")) {
      missing.push(where(n));
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && CREATE_CALL.test(n.expression.getText(source))) {
      check(n);
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && INSERT_TENANT.test(n.getText(source))) {
      check(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return { sites, missing };
};

describe("P20-07 — every tenant-creation path makes the self facility", () => {
  const results = sourceFiles().map((f) => sitesWithout(path.relative(SRC, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")));
  const sites = results.flatMap((r) => r.sites);

  it("finds the creation sites (not vacuous): createTenant, the child tenant, the three seeds", () => {
    expect(sites.map((s) => s.replace(/:\d+$/, "")).sort()).toEqual([
      "services/migration.service.ts",
      "services/migration.service.ts",
      "services/migration.service.ts",
      "services/tenant.service.ts",
      "services/tenantHierarchy.service.ts",
    ]);
  });

  it("each one's function also calls createSelfFacility", () => {
    expect(results.flatMap((r) => r.missing)).toEqual([]);
  });

  it("bites: a creation without the call, by model and by raw SQL", () => {
    const planted = `
      const a = async () => { await Tenant.create({ name: "x" }); };
      const b = async () => { await sql(db, "INSERT INTO tenants (id) VALUES ($1)", [id]); };
      const c = async () => { const t = await Tenants.create({ name: "y" }); await createSelfFacility(t); };`;
    expect(sitesWithout("planted.ts", planted)).toEqual({
      sites: ["planted.ts:2", "planted.ts:3", "planted.ts:4"],
      missing: ["planted.ts:2", "planted.ts:3"],
    });
  });
});
