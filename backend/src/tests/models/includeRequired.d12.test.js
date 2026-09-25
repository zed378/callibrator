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

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options) => {
    mockSql.statements.push(typeof sql === "string" ? sql : sql.query);
    return options && options.plain ? null : [];
  };
  return { db };
});

const fs = require("fs");
const path = require("path");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const espree = require(
  require.resolve("espree", { paths: [path.dirname(require.resolve("eslint/package.json"))] }),
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);
const SRC = path.join(__dirname, "..", "..");

/** Every model class in the barrel, deduplicated (the barrel exports aliases). */
const allModels = [...new Set(Object.values(models.sequelize.models))];

/**
 * The reviewed list of models whose defaultScope carries a `where`. Adding a
 * defaultScope `where` to another model turns every bare include of it into
 * an INNER JOIN — that is a decision, so it fails here until it is listed.
 */
const DEFAULT_SCOPED = Object.freeze([
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

const scopedModels = allModels.filter((m) => m._scope && m._scope.where);

beforeEach(() => {
  mockSql.statements = [];
});

describe("D-12 — the Sequelize behaviour, on generated SQL", () => {
  it("the default-scoped models are exactly the reviewed list", () => {
    expect(scopedModels.map((m) => m.name).sort()).toEqual([...DEFAULT_SCOPED]);
  });

  it("a bare include of a default-scoped model (no where, no required) is an INNER JOIN", async () => {
    await asTenant(() =>
      models.Stock.findAll({ include: [{ model: models.Warehouse, as: "warehouse" }] }),
    );
    expect(mockSql.statements[0]).toMatch(/ INNER JOIN "warehouses" AS "warehouse" ON /);
  });

  it("the same include with required: false is a LEFT OUTER JOIN", async () => {
    await asTenant(() =>
      models.Stock.findAll({
        include: [{ model: models.Warehouse, as: "warehouse", required: false }],
      }),
    );
    expect(mockSql.statements[0]).toMatch(/ LEFT OUTER JOIN "warehouses" AS "warehouse" ON /);
    expect(mockSql.statements[0]).not.toMatch(/INNER JOIN/);
  });

  it("a bare include of a model WITHOUT a defaultScope is a LEFT OUTER JOIN (the contrast)", async () => {
    await asTenant(() =>
      models.MaintenanceWorkOrder.findAll({ include: [{ model: models.Vendor, as: "vendor" }] }),
    );
    expect(mockSql.statements[0]).toMatch(/ LEFT OUTER JOIN "vendors" AS "vendor" ON /);
  });

  // D-12 DoD: the two lists whose missing rows are the ones a user is looking
  // for, pinned on the SQL the real service functions generate.
  it("the stock transfer list LEFT-joins the approver: a PENDING transfer (approved_by NULL) is listed", async () => {
    const stock = require("../../services/stock.service");
    await asTenant(() => stock.fetchTransfers({ tenantId: TENANT }));
    const select = mockSql.statements.find((s) => /FROM "stock_transfers"/.test(s) && /"approver"/.test(s));
    expect(select).toMatch(/ LEFT OUTER JOIN "users" AS "approver" ON /);
    expect(select).not.toMatch(/INNER JOIN/);
  });

  it("the CAPA list LEFT-joins the assignee: an UNASSIGNED CAPA is listed", async () => {
    const qms = require("../../services/qms.service");
    await asTenant(() => qms.getCapas(TENANT));
    const select = mockSql.statements.find((s) => /FROM "capas"/.test(s) && /"assignee"/.test(s));
    expect(select).toMatch(/ LEFT OUTER JOIN "users" AS "assignee" ON /);
    expect(select).not.toMatch(/INNER JOIN/);
  });

  it.each(DEFAULT_SCOPED.map((name) => [name]))(
    "%s: its defaultScope `where` makes a bare include required",
    (name) => {
      const model = allModels.find((m) => m.name === name);
      // Sequelize's own rule, as _validateIncludedElement applies it after
      // _injectScope: required = !!where. The scope's where is non-empty.
      expect(Object.keys(model._scope.where).length).toBeGreaterThan(0);
    },
  );
});

// ── The rule over the source ─────────────────────────────────────────────

/** Every name a default-scoped model is reachable by from the barrel. */
const scopedNames = new Set(
  Object.entries(models)
    .filter(([, v]) => scopedModels.includes(v))
    .map(([k]) => k),
);

/** Every association alias whose target is default-scoped (for `association: "x"` / "x"). */
const scopedAliases = new Set();
for (const model of allModels) {
  for (const association of Object.values(model.associations)) {
    if (scopedModels.includes(association.target)) {
      scopedAliases.add(association.as);
    }
  }
}

const keyOf = (p) =>
  p.type === "Property" ? (p.key.type === "Identifier" ? p.key.name : p.key.value) : null;

/** Does this spread argument state `required` on every branch? */
const spreadStatesRequired = (arg) => {
  if (arg.type === "ObjectExpression") {
    return arg.properties.some((p) => keyOf(p) === "required");
  }
  if (arg.type === "ConditionalExpression") {
    return spreadStatesRequired(arg.consequent) && spreadStatesRequired(arg.alternate);
  }
  // `...SOME_INCLUDE` — the constant is itself scanned (its name matches
  // /include/i) and must state `required`.
  return arg.type === "Identifier" && /include/i.test(arg.name);
};

/**
 * Scan one source text; return `[{ line, what }]` for every include entry of
 * a default-scoped model with no explicit `required`, plus the entry count.
 */
const scanSource = (source) => {
  const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script", loc: true });
  const renamed = new Map(); // `const { User: U } = models` → U means User
  const offenders = [];
  let entries = 0;

  const modelNameOf = (value) => {
    let name = null;
    if (value.type === "Identifier") {name = value.name;}
    if (value.type === "MemberExpression" && !value.computed) {name = value.property.name;}
    return renamed.get(name) || name;
  };

  const entry = (node) => {
    if (!node) {return;}
    switch (node.type) {
      case "ArrayExpression":
        node.elements.forEach(entry);
        return;
      case "SpreadElement":
        entry(node.argument);
        return;
      case "ConditionalExpression":
        entry(node.consequent);
        entry(node.alternate);
        return;
      case "LogicalExpression":
        entry(node.right);
        return;
      case "Literal":
        if (typeof node.value === "string") {
          entries += 1;
          // A bare string include cannot state `required` at all.
          if (scopedAliases.has(node.value)) {
            offenders.push({ line: node.loc.start.line, what: `"${node.value}" (string include)` });
          }
        }
        return;
      case "ObjectExpression": {
        entries += 1;
        const get = (k) => node.properties.find((p) => keyOf(p) === k);
        const model = get("model");
        const association = get("association");
        let what = null;
        if (model && scopedNames.has(modelNameOf(model.value))) {
          what = modelNameOf(model.value);
        }
        if (association && association.value.type === "Literal" && scopedAliases.has(association.value.value)) {
          what = `association "${association.value.value}"`;
        }
        const separate = get("separate");
        const stated =
          Boolean(get("required")) ||
          node.properties.some((p) => p.type === "SpreadElement" && spreadStatesRequired(p.argument));
        const isSeparate = separate && separate.value.type === "Literal" && separate.value.value === true;
        if (what && !stated && !isSeparate) {
          offenders.push({ line: node.loc.start.line, what });
        }
        return;
      }
      default:
    }
  };

  const returnsOf = (body, out = []) => {
    if (!body || typeof body.type !== "string") {return out;}
    if (body.type === "ReturnStatement") {out.push(body.argument);}
    for (const [k, child] of Object.entries(body)) {
      if (k === "loc") {continue;}
      if (Array.isArray(child)) {child.forEach((c) => returnsOf(c, out));}
      else if (child && typeof child.type === "string" && !/Function/.test(child.type)) {returnsOf(child, out);}
    }
    return out;
  };

  const visit = (node) => {
    if (!node || typeof node.type !== "string") {return;}
    if (node.type === "VariableDeclarator" && node.id.type === "ObjectPattern") {
      for (const p of node.id.properties) {
        if (p.type === "Property" && p.key.type === "Identifier" && p.value.type === "Identifier" && scopedNames.has(p.key.name)) {
          renamed.set(p.value.name, p.key.name);
        }
      }
    }
    // `include: …`
    if (node.type === "Property" && keyOf(node) === "include") {entry(node.value);}
    // `const include = …` / `const CATEGORY_INCLUDE = …` / `x.include = …`
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && /include/i.test(node.id.name) && node.init) {
      const init = node.init;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        (init.body.type === "BlockStatement" ? returnsOf(init.body) : [init.body]).forEach(entry);
      } else {
        entry(init);
      }
    }
    if (node.type === "FunctionDeclaration" && node.id && /include/i.test(node.id.name)) {
      returnsOf(node.body).forEach(entry);
    }
    if (
      node.type === "AssignmentExpression" &&
      ((node.left.type === "Identifier" && /include/i.test(node.left.name)) ||
        (node.left.type === "MemberExpression" && !node.left.computed && /include/i.test(node.left.property.name)))
    ) {
      entry(node.right);
    }
    // `includes.push({ … })`
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.name === "push" &&
      node.callee.object.type === "Identifier" &&
      /include/i.test(node.callee.object.name)
    ) {
      node.arguments.forEach(entry);
    }
    for (const [k, child] of Object.entries(node)) {
      if (k === "loc") {continue;}
      if (Array.isArray(child)) {child.forEach(visit);}
      else if (child && typeof child.type === "string") {visit(child);}
    }
  };

  visit(ast);
  return { offenders, entries };
};

/** Every production .js file under backend/src. */
const sourceFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!["tests", "migrations"].includes(name)) {walk(full);}
      } else if (name.endsWith(".js")) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
};

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
      (n, file) => n + scanSource(fs.readFileSync(file, "utf8")).entries,
      0,
    );
    expect(entries).toBeGreaterThanOrEqual(120);
  });

  it("no production include of a default-scoped model leaves `required` to the defaultScope", () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      for (const o of scanSource(fs.readFileSync(file, "utf8")).offenders) {
        offenders.push(`${path.relative(SRC, file)}:${o.line} ${o.what}`);
      }
    }
    // Each entry: add `required: false` (a relation — the row must survive a
    // null / soft-deleted / foreign reference) or `required: true` with a
    // comment saying why the include is a filter. See CLAUDE.md, The Traps.
    expect(offenders).toEqual([]);
  });
});
