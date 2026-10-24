/**
 * D-12 — an include of a default-scoped model must say `required` out loud.
 *
 * Sequelize defaults an include's `required` to `!!include.where` AFTER it has
 * merged the included model's defaultScope `where` into the include. So an
 * include of any model whose defaultScope carries a `where` (User, Role,
 * Tenant, CalibrationDevice, Warehouse, … — `is_deleted = false`) is an INNER
 * JOIN even though the call site names no `where` at all: the join type is a
 * property of the INCLUDED model, invisible at the call. A null or
 * soft-deleted reference then removes the PARENT row with no error (A-75,
 * A-90, A-109 — the most repeated defect shape in this codebase, CLAUDE.md).
 *
 * Two halves:
 *
 *  1. THE SEQUELIZE BEHAVIOUR, pinned on generated SQL (the real models
 *     barrel, real hooks, an UNCONNECTED PostgreSQL-dialect Sequelize whose
 *     `query` records). If a Sequelize upgrade stops turning a defaultScope
 *     into an INNER JOIN, this reports it instead of hiding it — and the list
 *     of default-scoped models is pinned, so a NEW defaultScope `where` is a
 *     reviewed change, not a silent one.
 *
 *  2. THE RULE, over the source: every include entry of a default-scoped
 *     model in `backend/src` (tests and migrations excluded) carries an
 *     explicit `required` — `false` for a relation, `true` where the include
 *     is a filter (and then a comment says why). `separate: true` includes are
 *     exempt: they are their own query, not a join. This is the lint rule the
 *     card asks for; it runs in `make verify` because it is a test.
 *
 * The rule is proven to bite (a synthetic source with a bare include is
 * flagged), so a scanner that silently finds nothing cannot pass it.
 */
import type * as SequelizeModule from "sequelize";
import type * as ModelsModule from "../../models";
import type * as TenantContextModule from "../../middlewares/tenantContext.middleware";
import type stockService from "../../services/stock.service";
import type qmsService from "../../services/qms.service";
import type * as TsEstreeModule from "@typescript-eslint/typescript-estree";
import fs from "fs";
import path from "path";
import { toTenantId } from "../../types/ids";

const mockSql: { statements: string[] } = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = ((sql: string | { query: string }, options?: { plain?: boolean }) => {
    mockSql.statements.push(typeof sql === "string" ? sql : sql.query);
    return Promise.resolve(options?.plain === true ? null : []);
  }) as unknown as typeof db.query;
  return { db };
});

const models = jest.requireActual<typeof ModelsModule>("../../models");
const { tenantStorage } = jest.requireActual<typeof TenantContextModule>("../../middlewares/tenantContext.middleware");

interface EspreeModule {
  parse(source: string, options: { ecmaVersion: string; sourceType: string; loc: boolean }): unknown;
}

const espree = jest.requireActual("espree") as unknown as EspreeModule;

const tsEstree = jest.requireActual<typeof TsEstreeModule>("@typescript-eslint/typescript-estree");

const TENANT = toTenantId("11111111-1111-4111-8111-111111111111");
const asTenant = <T>(fn: () => T): T =>
  tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, fn);
const SRC = path.join(__dirname, "..", "..");

interface ModelLike {
  readonly name: string;
  readonly _scope?: { where?: Record<string, unknown> };
}

/** Every model class in the barrel, deduplicated (the barrel exports aliases). */
const allModels = [...new Set(Object.values(models.sequelize.models))] as unknown as ModelLike[];

/**
 * The reviewed list of models whose defaultScope carries a `where`. Adding a
 * defaultScope `where` to another model turns every bare include of it into
 * an INNER JOIN — that is a decision, so it fails here until it is listed.
 */
const DEFAULT_SCOPED: readonly string[] = Object.freeze([
  "ApiKey",
  "Attachment",
  "CalibrationDevice",
  "CalibrationRecord",
  "Category",
  "Post",
  "Role",
  "Session",
  "Stock",
  "Tenant",
  "User",
  "Warehouse",
  "Webhook",
]);

const scopedModels = allModels.filter((m) => m._scope?.where !== undefined);

beforeEach(() => {
  mockSql.statements = [];
});

describe("D-12 — the Sequelize behaviour, on generated SQL", () => {
  it("the default-scoped models are exactly the reviewed list", () => {
    expect(scopedModels.map((m) => m.name).sort()).toEqual([...DEFAULT_SCOPED]);
  });

  it("a bare include of a default-scoped model (no where, no required) is an INNER JOIN", async () => {
    await asTenant(() =>
      (models.Stock as unknown as { findAll(options: unknown): Promise<unknown> }).findAll({
        include: [{ model: models.Warehouse, as: "warehouse" }],
      }),
    );
    expect(mockSql.statements[0]).toMatch(/ INNER JOIN "warehouses" AS "warehouse" ON /);
  });

  it("the same include with required: false is a LEFT OUTER JOIN", async () => {
    await asTenant(() =>
      (models.Stock as unknown as { findAll(options: unknown): Promise<unknown> }).findAll({
        include: [{ model: models.Warehouse, as: "warehouse", required: false }],
      }),
    );
    expect(mockSql.statements[0]).toMatch(/ LEFT OUTER JOIN "warehouses" AS "warehouse" ON /);
    expect(mockSql.statements[0]).not.toMatch(/INNER JOIN/);
  });

  it("a bare include of a model WITHOUT a defaultScope is a LEFT OUTER JOIN (the contrast)", async () => {
    await asTenant(() =>
      (models.MaintenanceWorkOrder as unknown as { findAll(options: unknown): Promise<unknown> }).findAll({
        include: [{ model: models.Vendor, as: "vendor" }],
      }),
    );
    expect(mockSql.statements[0]).toMatch(/ LEFT OUTER JOIN "vendors" AS "vendor" ON /);
  });

  // D-12 DoD: the two lists whose missing rows are the ones a user is looking
  // for, pinned on the SQL the real service functions generate.
  it("the stock transfer list LEFT-joins the approver: a PENDING transfer (approved_by NULL) is listed", async () => {
    const stock = jest.requireActual<typeof stockService>("../../services/stock.service");
    await asTenant(() => stock.fetchTransfers({ tenantId: TENANT }));
    const select = mockSql.statements.find((s) => s.includes('FROM "stock_transfers"') && s.includes('"approver"'));
    expect(select).toMatch(/ LEFT OUTER JOIN "users" AS "approver" ON /);
    expect(select).not.toMatch(/INNER JOIN/);
  });

  it("the CAPA list LEFT-joins the assignee: an UNASSIGNED CAPA is listed", async () => {
    const qms = jest.requireActual<typeof qmsService>("../../services/qms.service");
    await asTenant(() => qms.getCapas(TENANT));
    const select = mockSql.statements.find((s) => s.includes('FROM "capas"') && s.includes('"assignee"'));
    expect(select).toMatch(/ LEFT OUTER JOIN "users" AS "assignee" ON /);
    expect(select).not.toMatch(/INNER JOIN/);
  });

  it.each(DEFAULT_SCOPED.map((name) => [name]))(
    "%s: its defaultScope `where` makes a bare include required",
    (name) => {
      const model = allModels.find((m) => m.name === name);
      // Sequelize's own rule, as _validateIncludedElement applies it after
      // _injectScope: required = !!where. The scope's where is non-empty.
      expect(Object.keys(model?._scope?.where ?? {}).length).toBeGreaterThan(0);
    },
  );
});

// ── The rule over the source ─────────────────────────────────────────────

/** An ESTree node: the parser's output, untyped by design. */
type AstNode = Record<string, unknown>;

/** A node with a string `type` — the only shape the visitor touches. */
interface TypedNode extends AstNode {
  readonly type: string;
}

const isNode = (value: unknown): value is TypedNode =>
  typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)["type"] === "string";

const childNode = (value: unknown): TypedNode | undefined => (isNode(value) ? value : undefined);

const childString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Every name a default-scoped model is reachable by from the barrel. */
const scopedNames = new Set(
  Object.entries(models as unknown as Record<string, unknown>)
    .filter(([, v]) => (scopedModels as unknown[]).includes(v))
    .map(([k]) => k),
);

interface AssociationLike {
  readonly target: unknown;
  readonly as: string;
}

/** Every association alias whose target is default-scoped (for `association: "x"` / "x"). */
const scopedAliases = new Set<string>();
for (const model of allModels) {
  for (const association of Object.values(
    (model as unknown as { associations: Record<string, AssociationLike> }).associations,
  )) {
    if ((scopedModels as unknown[]).includes(association.target)) {
      scopedAliases.add(association.as);
    }
  }
}

const propName = (p: TypedNode): string | null => {
  const key = p["key"];
  if (typeof key === "string") {
    return key;
  }
  if (isNode(key)) {
    if (key.type === "Identifier") {
      return childString(key["name"]) ?? null;
    }
    const value = key["value"];
    return typeof value === "string" ? value : null;
  }
  return null;
};

const keyOf = (p: TypedNode): string | null => (p.type === "Property" ? propName(p) : null);

/** Does this spread argument state `required` on every branch? */
const spreadStatesRequired = (arg: TypedNode): boolean => {
  if (arg.type === "ObjectExpression") {
    const properties = arg["properties"];
    return (
      Array.isArray(properties) &&
      properties.some((p) => isNode(p) && keyOf(p) === "required")
    );
  }
  if (arg.type === "ConditionalExpression") {
    const consequent = childNode(arg["consequent"]);
    const alternate = childNode(arg["alternate"]);
    return consequent !== undefined && alternate !== undefined && spreadStatesRequired(consequent) && spreadStatesRequired(alternate);
  }
  // `...SOME_INCLUDE` — the constant is itself scanned (its name matches
  // /include/i) and must state `required`.
  return arg.type === "Identifier" && /include/i.test(childString(arg["name"]) ?? "");
};

interface Offender {
  readonly line: number;
  readonly what: string;
}

const lineOf = (node: TypedNode): number => {
  const loc = node["loc"];
  if (typeof loc === "object" && loc !== null) {
    const start = (loc as Record<string, unknown>)["start"];
    if (typeof start === "object" && start !== null) {
      const line = (start as Record<string, unknown>)["line"];
      if (typeof line === "number") {
        return line;
      }
    }
  }
  return 0;
};

/**
 * Scan one source text; return `[{ line, what }]` for every include entry of
 * a default-scoped model with no explicit `required`, plus the entry count.
 */
// ADR-087 Amendment 4: a converted (.ts) file is parsed with typescript-estree,
// which yields the same ESTree node shapes espree does (plus TS-only nodes the
// visitor walks past), so the rule reads converted files exactly as before.
const scanSource = (source: string, file = ""): { offenders: Offender[]; entries: number } => {
  const ast = file.endsWith(".ts")
    ? (tsEstree.parse(source, { loc: true }) as unknown as TypedNode)
    : (espree.parse(source, { ecmaVersion: "latest", sourceType: "script", loc: true }) as TypedNode);
  const renamed = new Map<string, string>(); // `const { User: U } = models` → U means User
  const offenders: Offender[] = [];
  let entries = 0;

  const modelNameOf = (value: TypedNode): string | null => {
    let name: string | null = null;
    if (value.type === "Identifier") {
      name = childString(value["name"]) ?? null;
    }
    if (value.type === "MemberExpression" && value["computed"] !== true) {
      const property = childNode(value["property"]);
      name = (property !== undefined ? childString(property["name"]) : undefined) ?? null;
    }
    return (name !== null ? renamed.get(name) : undefined) ?? name;
  };

  const entry = (node: unknown): void => {
    if (!isNode(node)) {
      return;
    }
    switch (node.type) {
      case "ArrayExpression": {
        const elements = node["elements"];
        if (Array.isArray(elements)) {
          elements.forEach(entry);
        }
        return;
      }
      case "SpreadElement": {
        const argument = node["argument"];
        if (argument !== undefined) {
          entry(argument);
        }
        return;
      }
      case "ConditionalExpression": {
        const consequent = node["consequent"];
        const alternate = node["alternate"];
        if (consequent !== undefined) {
          entry(consequent);
        }
        if (alternate !== undefined) {
          entry(alternate);
        }
        return;
      }
      case "LogicalExpression": {
        const right = node["right"];
        if (right !== undefined) {
          entry(right);
        }
        return;
      }
      case "Literal":
        if (typeof node["value"] === "string") {
          entries += 1;
          // A bare string include cannot state `required` at all.
          if (scopedAliases.has(node["value"])) {
            offenders.push({ line: lineOf(node), what: `"${node["value"]}" (string include)` });
          }
        }
        return;
      case "ObjectExpression": {
        entries += 1;
        const rawProperties = node["properties"];
        const properties = Array.isArray(rawProperties) ? rawProperties.filter(isNode) : [];
        const get = (k: string): TypedNode | undefined => properties.find((p) => keyOf(p) === k);
        const model = get("model");
        const association = get("association");
        let what: string | null = null;
        const modelValue = model !== undefined ? childNode(model["value"]) : undefined;
        if (model !== undefined && modelValue !== undefined && scopedNames.has(modelNameOf(modelValue) ?? "")) {
          what = modelNameOf(modelValue);
        }
        const associationValue = association !== undefined ? childNode(association["value"]) : undefined;
        if (
          associationValue?.type === "Literal" &&
          typeof associationValue["value"] === "string" &&
          scopedAliases.has(associationValue["value"])
        ) {
          what = `association "${associationValue["value"]}"`;
        }
        const separate = get("separate");
        const separateValue = separate !== undefined ? childNode(separate["value"]) : undefined;
        const stated =
          get("required") !== undefined ||
          properties.some((p) => {
            const argument = childNode(p["argument"]);
            return p.type === "SpreadElement" && argument !== undefined && spreadStatesRequired(argument);
          });
        const isSeparate = separateValue?.type === "Literal" && separateValue["value"] === true;
        if (what !== null && !stated && !isSeparate) {
          offenders.push({ line: lineOf(node), what });
        }
        return;
      }
      default:
    }
  };

  const returnsOf = (body: unknown, out: (TypedNode | null)[] = []): (TypedNode | null)[] => {
    if (!isNode(body) && !Array.isArray(body)) {
      return out;
    }
    if (Array.isArray(body)) {
      body.forEach((c) => returnsOf(c, out));
      return out;
    }
    if (body.type === "ReturnStatement") {
      const argument = body["argument"];
      out.push(isNode(argument) ? argument : null);
    }
    for (const [k, child] of Object.entries(body)) {
      if (k === "loc" || k === "type") {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach((c) => {
          if (isNode(c) && !c.type.includes("Function")) {
            returnsOf(c, out);
          }
        });
      } else if (isNode(child) && !child.type.includes("Function")) {
        returnsOf(child, out);
      }
    }
    return out;
  };

  const visit = (node: unknown): void => {
    if (!isNode(node)) {
      return;
    }
    const nodeId = childNode(node["id"]);
    if (node.type === "VariableDeclarator" && nodeId?.type === "ObjectPattern") {
      const rawProperties = nodeId["properties"];
      const props = Array.isArray(rawProperties) ? rawProperties.filter(isNode) : [];
      for (const p of props) {
        const key = childNode(p["key"]);
        const value = childNode(p["value"]);
        if (p.type === "Property" && key?.type === "Identifier" && value?.type === "Identifier") {
          const keyName = childString(key["name"]);
          const valueName = childString(value["name"]);
          if (keyName !== undefined && valueName !== undefined && scopedNames.has(keyName)) {
            renamed.set(valueName, keyName);
          }
        }
      }
    }
    // ADR-087 Amendment 4: the TypeScript spelling of the same rename,
    // `import { User as U } from "../models"`.
    const imported = childNode(node["imported"]);
    const local = childNode(node["local"]);
    if (node.type === "ImportSpecifier" && imported?.type === "Identifier" && local !== undefined) {
      const importedName = childString(imported["name"]);
      const localName = childString(local["name"]);
      if (importedName !== undefined && localName !== undefined && scopedNames.has(importedName)) {
        renamed.set(localName, importedName);
      }
    }
    // `include: …`
    const nodeValue = node["value"];
    if (node.type === "Property" && keyOf(node) === "include" && nodeValue !== undefined) {
      entry(nodeValue);
    }
    // `const include = …` / `const CATEGORY_INCLUDE = …` / `x.include = …`
    const nodeInit = childNode(node["init"]);
    if (
      node.type === "VariableDeclarator" &&
      nodeId?.type === "Identifier" &&
      /include/i.test(childString(nodeId["name"]) ?? "") &&
      nodeInit !== undefined
    ) {
      if (nodeInit.type === "ArrowFunctionExpression" || nodeInit.type === "FunctionExpression") {
        const fnBody = nodeInit["body"];
        if (isNode(fnBody) && fnBody.type === "BlockStatement") {
          returnsOf(fnBody).forEach(entry);
        } else if (fnBody !== undefined) {
          entry(fnBody);
        }
      } else {
        entry(nodeInit);
      }
    }
    if (node.type === "FunctionDeclaration" && /include/i.test(childString(nodeId?.["name"]) ?? "")) {
      const fnBody = node["body"];
      if (fnBody !== undefined) {
        returnsOf(fnBody).forEach(entry);
      }
    }
    const left = childNode(node["left"]);
    if (node.type === "AssignmentExpression" && left !== undefined) {
      const leftProperty = childNode(left["property"]);
      const isIncludeTarget =
        (left.type === "Identifier" && /include/i.test(childString(left["name"]) ?? "")) ||
        (left.type === "MemberExpression" &&
          left["computed"] !== true &&
          /include/i.test(childString(leftProperty?.["name"]) ?? ""));
      const right = node["right"];
      if (isIncludeTarget && right !== undefined) {
        entry(right);
      }
    }
    // `includes.push({ … })`
    const callee = childNode(node["callee"]);
    if (node.type === "CallExpression" && callee?.type === "MemberExpression") {
      const property = childNode(callee["property"]);
      const object = childNode(callee["object"]);
      if (
        childString(property?.["name"]) === "push" &&
        object?.type === "Identifier" &&
        /include/i.test(childString(object["name"]) ?? "")
      ) {
        const args = node["arguments"];
        if (Array.isArray(args)) {
          args.forEach(entry);
        }
      }
    }
    for (const [k, child] of Object.entries(node)) {
      if (k === "loc" || k === "type") {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach((c) => {
          if (isNode(c)) {
            visit(c);
          }
        });
      } else if (isNode(child)) {
        visit(child);
      }
    }
  };

  visit(ast);
  return { offenders, entries };
};

/** Every production .js file under backend/src. */
const sourceFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!["tests", "migrations"].includes(name)) {
          walk(full);
        }
      } else if (/\.(js|ts)$/.test(name) && !name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
};

/**
 * P9-10 (ADR-087 Amendment 7; spec item 6): a CONVERTED model declares the
 * phantom brand `defaultScoped: DefaultScoped` among its statics exactly when
 * its runtime defaultScope carries a `where`. The brand emits nothing, so only
 * this test keeps it honest: the branded set must EQUAL the runtime set,
 * restricted to the converted (.model.ts) files.
 */
// A declaration line — not a mention inside a comment.
const BRAND = /^\s*(?:readonly\s+)?defaultScoped\s*:\s*DefaultScoped\b/m;
const MODEL_NAME = /\bmodelName\s*:\s*"(\w+)"/;
const brandedSets = (files: [string, string][]): { branded: string[]; converted: string[] } => {
  const branded: string[] = [];
  const converted: string[] = [];
  for (const [file, text] of files) {
    const m = MODEL_NAME.exec(text);
    if (!m) {
      throw new Error(`${file}: no modelName`);
    }
    converted.push(m[1] as string);
    if (BRAND.test(text)) {
      branded.push(m[1] as string);
    }
  }
  return { branded: branded.sort(), converted: converted.sort() };
};
const convertedModelFiles = (): [string, string][] =>
  fs
    .readdirSync(path.join(SRC, "models"))
    .filter((f) => f.endsWith(".model.ts"))
    .map((f) => [f, fs.readFileSync(path.join(SRC, "models", f), "utf8")]);

describe("D-12 — the phantom brand on converted models equals the runtime default-scoped set", () => {
  it("the brand check bites: a missing brand and a stray brand are both seen", () => {
    const { branded, converted } = brandedSets([
      ["a.model.ts", 'interface AStatics {\n  readonly defaultScoped: DefaultScoped;\n}\n{ modelName: "A" }'],
      ["b.model.ts", 'interface BStatics { associate: () => void }\n{ modelName: "B" }'],
      // A brand mentioned in a comment is not a brand.
      ["c.model.ts", 'interface CStatics {\n  // readonly defaultScoped: DefaultScoped;\n}\n{ modelName: "C" }'],
    ]);
    expect(converted).toEqual(["A", "B", "C"]);
    expect(branded).toEqual(["A"]);
    // Against a runtime where B is default-scoped and A is not, both directions differ.
    const runtime = ["B"];
    expect(branded.filter((n) => !runtime.includes(n))).toEqual(["A"]);
    expect(runtime.filter((n) => !branded.includes(n))).toEqual(["B"]);
  });

  it("every converted model is branded iff its defaultScope has a where", () => {
    const { branded, converted } = brandedSets(convertedModelFiles());
    // P9-10 is complete: all 71 models are .ts, so the branded set must be the WHOLE runtime set
    // (the reviewed DEFAULT_SCOPED list above), and a scanner finding fewer files cannot pass.
    // P10-05 adds a 72nd, born TypeScript: AccessRequest (no defaultScope, so unbranded);
    // ADR-108 Amendment 1 a 73rd: WebauthnCredential (no defaultScope).
    // P20-01 / P20-03 (ADR-125 Am. 1, G-4) six more, none with a defaultScope: DeviceType and the
    // inspection catalogue (InspectionItemDefinition, -Template, -TemplateVersion, -TemplateItem,
    // -TemplateProposal) — 79.
    // The rsync image import adds UpstreamFileImport (born TypeScript, no defaultScope) — 80.
    // The SQL-dump import (P24-06) adds UpstreamSqlImport (born TypeScript, no defaultScope) — 81.
    // P20-07 (ADR-124 Am. 2, G-F3) adds ClientFacility and ClientFacilityMove, neither paranoid nor
    // with a defaultScope (an include of a facility must never be an INNER JOIN) — 83.
    // P20-04 (ADR-126 Am. 1, G-S4) adds InspectionSession, InspectionResult,
    // InspectionSessionSignature and IdempotencyKey, none paranoid nor with a defaultScope — 87.
    // P21-08 (ADR-138) adds PublicDeviceToken, neither paranoid nor default-scoped — 88.
    // P24-09a (ADR-139) adds UserInvitation, neither paranoid nor default-scoped — 89.
    expect(converted.length).toBe(89);
    expect(branded).toEqual([...DEFAULT_SCOPED]);
    const runtimeScoped = scopedModels.map((m) => m.name).filter((n) => converted.includes(n)).sort();
    expect(branded).toEqual(runtimeScoped);
  });
});

describe("D-12 — the rule: every include of a default-scoped model states `required`", () => {
  it("the scanner bites: bare includes of default-scoped models are flagged, stated ones are not", () => {
    const { offenders } = scanSource(`
      const { User: U } = require("../models");
      const CAPA_INCLUDE = { model: User, as: "assignee" };            // 3: flagged
      async function f() {
        await Capa.findAll({ include: [
          { model: U, as: "assignee" },                                  // 6: flagged (renamed)
          { model: models.Role, as: "role", required: false },
          { model: Vendor, as: "vendor" },                               // not default-scoped
          { association: "warehouse" },                                  // 9: flagged
          { association: "calibrationRecords", separate: true },         // separate: exempt
          "tenant",                                                      // 11: flagged
          { ...CAPA_INCLUDE },
          { model: Tenant, as: "tenant", ...(x ? { required: true } : {}) }, // 13: flagged
          { model: Tenant, as: "tenant", ...(x ? { required: true } : { required: false }) },
        ] });
      }
    `);
    expect(offenders.map((o) => o.line)).toEqual([3, 6, 9, 11, 13]);
  });

  it("found the include sites (a scanner that finds nothing cannot pass)", () => {
    const entries = sourceFiles().reduce(
      (n, file) => n + scanSource(fs.readFileSync(file, "utf8"), file).entries,
      0,
    );
    expect(entries).toBeGreaterThanOrEqual(120);
  });

  it("no production include of a default-scoped model leaves `required` to the defaultScope", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const o of scanSource(fs.readFileSync(file, "utf8"), file).offenders) {
        offenders.push(`${path.relative(SRC, file)}:${String(o.line)} ${o.what}`);
      }
    }
    // Each entry: add `required: false` (a relation — the row must survive a
    // null / soft-deleted / foreign reference) or `required: true` with a
    // comment saying why the include is a filter. See CLAUDE.md, The Traps.
    expect(offenders).toEqual([]);
  });
});
