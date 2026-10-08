/**
 * P21-09e — G-24 (spec P19-04 § 12 rule 1; the A-90 sweep): an include that a facility-BOUND viewer
 * resolves to null must never be an INNER join, or the facility's own row disappears.
 *
 * For a bound principal the hooks deny every PROVIDER-INTERNAL model per include (a tenant model
 * with no facility column and no FACILITY_READABLE rule — vendors, API keys …) and `User` resolves
 * provider staff to null (they have no facility). So every include, in application source, of an
 * association whose SOURCE is a facility-scoped model and whose TARGET is `User` or provider-
 * internal must say `required: false` (a `separate: true` include is its own query, exempt). The
 * associations are read from the REAL model registry, so a new one is covered without editing this
 * file; the include sites are read from the source AST (`as` / `association` naming the alias).
 *
 * D-12 (`models/includeRequired.d12`) already demands an explicit `required` on a default-scoped
 * include; this is the stricter facility rule: `true` is refused too for these targets.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import { FACILITY_READABLE } from "../../constants/facilityAccess";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

interface Assoc { target: { name: string; rawAttributes: Record<string, unknown> } }
interface ModelLike { name: string; rawAttributes: Record<string, unknown>; associations: Record<string, Assoc> }

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real barrel, after the config mock
const barrel = require("../../models") as { sequelize: { models: Record<string, ModelLike> } };
const SRC = path.join(__dirname, "../..");

const hasFacility = (m: { rawAttributes: Record<string, unknown> }): boolean => "clientFacilityId" in m.rawAttributes || "client_facility_id" in m.rawAttributes;
const hasTenant = (m: { rawAttributes: Record<string, unknown> }): boolean => "tenantId" in m.rawAttributes || "tenant_id" in m.rawAttributes;
const providerInternal = (m: { name: string; rawAttributes: Record<string, unknown> }): boolean =>
  hasTenant(m) && !hasFacility(m) && !Object.hasOwn(FACILITY_READABLE, m.name);

/** Aliases (association names) from a facility-scoped source to User or a provider-internal target. */
const riskyAliases = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const model of Object.values(barrel.sequelize.models)) {
    if (!hasFacility(model)) {continue;}
    for (const [alias, assoc] of Object.entries(model.associations)) {
      if (assoc.target.name === "User" || providerInternal(assoc.target)) {
        out.set(alias, `${model.name}.${alias} → ${assoc.target.name}`);
      }
    }
  }
  return out;
};

/**
 * Files whose includes share an alias with a facility-scoped association but whose ROOT is
 * provider-internal (a bound principal never reaches the query) — with why.
 */
const PROVIDER_ROOTS: Readonly<Record<string, string>> = {
  "services/supplierScorecard.service.ts":
    "the root is SupplierScorecard (provider-internal; `/supplier-scorecard/*` is unmarked, P18-03 § 8.2) — its `vendor` alias is not MaintenanceWorkOrder's",
};

const sourceFiles = (): string[] =>
  ["services", "controllers", "utils"].flatMap((dir) =>
    (fs.readdirSync(path.join(SRC, dir), { recursive: true }) as string[])
      .map((f) => path.join(SRC, dir, f))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")),
  );

/** Include object literals naming a risky alias without `required: false` (and not `separate: true`). */
const violationsIn = (file: string, text: string, aliases: ReadonlyMap<string, string>): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const prop = (o: ts.ObjectLiteralExpression, name: string): ts.Expression | null => {
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(source) === name) {return p.initializer;}
    }
    return null;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const named = prop(n, "as") ?? prop(n, "association");
      const alias = named && ts.isStringLiteral(named) ? named.text : null;
      const isInclude = prop(n, "model") !== null || prop(n, "association") !== null;
      if (alias && isInclude && aliases.has(alias)) {
        const required = prop(n, "required");
        const separate = prop(n, "separate");
        const ok = required?.kind === ts.SyntaxKind.FalseKeyword || separate?.kind === ts.SyntaxKind.TrueKeyword;
        if (!ok) {
          const line = source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
          out.push(`${file}:${String(line)} ${aliases.get(alias) ?? alias}`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return out;
};

describe("G-24 — includes a bound viewer resolves to null are LEFT joins", () => {
  const aliases = riskyAliases();

  it("sanity: the registry yields the known risky associations", () => {
    expect([...aliases.keys()]).toEqual(expect.arrayContaining(["performer", "calibratedByUser", "approvedByUser", "signedByUser", "assignee", "uploader", "vendor"]));
  });

  it("every such include in services, controllers and utils says `required: false`", () => {
    const found = sourceFiles()
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => !Object.hasOwn(PROVIDER_ROOTS, rel))
      .flatMap((rel) => violationsIn(rel, fs.readFileSync(path.join(SRC, rel), "utf8"), aliases));
    expect(found).toEqual([]);
  });

  it("every provider-root exemption still names a file with such an include", () => {
    for (const rel of Object.keys(PROVIDER_ROOTS)) {
      expect({ rel, hits: violationsIn(rel, fs.readFileSync(path.join(SRC, rel), "utf8"), aliases).length > 0 }).toEqual({ rel, hits: true });
    }
  });

  it("bites (fail-before): a bare and an INNER include of the performer are found; LEFT and separate pass", () => {
    const planted = [
      "const a = { include: [{ model: models.User, as: \"performer\" }] };",
      "const b = { include: [{ model: models.User, as: \"assignee\", required: true }] };",
      "const c = { include: [{ model: models.User, as: \"uploader\", required: false }] };",
      "const d = { include: [{ association: \"vendor\", separate: true }] };",
    ].join("\n");
    expect(violationsIn("planted.ts", planted, aliases).map((v) => v.split(" ")[0])).toEqual(["planted.ts:1", "planted.ts:2"]);
  });
});
