/**
 * A-87 — the tenant hooks reach includes.
 *
 * Before A-87 the global hooks (utils/tenantScope.util.js) put the tenant
 * predicate on the ROOT model's WHERE only: an include of a tenant-scoped
 * model joined whatever row its foreign key pointed at, in any tenant. This
 * file proves the mechanism fix against the SQL Sequelize actually generates:
 *
 *  - Part 1 is DATA-DRIVEN over every association in the REAL models barrel
 *    (real models, real associations, real global hooks) on an UNCONNECTED
 *    PostgreSQL-dialect Sequelize whose `query` is a recorder. For every
 *    association whose target is tenant-scoped it asserts the tenant predicate
 *    is in that join's ON clause, and that the join type is exactly what
 *    Sequelize chooses with no tenant context (the no-hook baseline) — for an
 *    implicit, a `required: false` and a `required: true` include. A new
 *    association is covered the day it is written; nothing here is a list.
 *  - Part 2 pins the named behaviours: nested includes, count and
 *    findAndCountAll, super admin / system / deny, non-plain `where`.
 *  - Part 3 uses a purpose-built model set for the shapes the real barrel does
 *    not have: a tenant-scoped `through` model, `separate: true`, the
 *    include-level `skipTenantScope` opt-out, `include: []`, `{ all: true }`.
 *
 * What this does NOT prove is that PostgreSQL executes the SQL the way it
 * reads. That was checked against pgvector/pgvector:pg18 (see the A-87 record).
 *
 * Why this is not "a test generated from the code it tests" (CLAUDE.md,
 * Evidence): the expectations come from Sequelize's own SQL with the hook's
 * context switched off, not from the hook's logic. Delete the include walk and
 * every Part 1 predicate assertion fails; replace it with a naive
 * `include.where = { tenantId }` and every implicit-LEFT join assertion fails.
 */

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockSql.statements.push(text);
    return /^SELECT count\(/i.test(text) ? { count: 1 } : [];
  };
  return { db };
});

const { Sequelize, DataTypes, Op } = require("sequelize");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const tenantScope = require("../../utils/tenantScope.util");

const TENANT = "11111111-1111-4111-8111-111111111111";
const { NO_TENANT_UUID } = tenantScope;

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

/** The last row SELECT (not a count) recorded. */
const lastSelect = () =>
  [...mockSql.statements].reverse().find((s) => /^SELECT (?!count\()/i.test(s));
const lastCount = () =>
  [...mockSql.statements].reverse().find((s) => /^SELECT count\(/i.test(s));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const END = "(?= LEFT OUTER JOIN | INNER JOIN | WHERE | LIMIT |;|$)";

/**
 * The join an association produced: its type and its ON condition.
 * A belongsToMany renders as `JOIN ( through INNER JOIN target ON ..) ON ..`;
 * the whole parenthesised block and its trailing ON are returned as `on`.
 * @returns {{ type: string, on: string }}
 */
const joinOf = (sql, association) => {
  const alias = association.as;
  let re;
  if (association.through) {
    const through = association.through.model;
    re = new RegExp(
      `(LEFT OUTER|INNER) JOIN \\( "${esc(through.getTableName())}" AS "${esc(`${alias}->${through.name}`)}" (.*?\\) ON .*?)${END}`,
    );
  } else {
    re = new RegExp(
      `(LEFT OUTER|INNER) JOIN "${esc(association.target.getTableName())}" AS "${esc(alias)}" ON (.*?)${END}`,
    );
  }
  const match = sql.match(re);
  if (!match) {throw new Error(`no join for ${alias} in: ${sql}`);}
  return { type: match[1], on: match[2] };
};

/** `"alias"."tenant_col" = 'value'` for a model under an alias, or null. */
const predicateFor = (model, alias, value) => {
  const key = tenantScope.tenantKeyOf(model);
  if (!key) {return null;}
  const field = model.rawAttributes[key].field || key;
  return `"${alias}"."${field}" = '${value}'`;
};

beforeEach(() => {
  mockSql.statements = [];
});

// ---------------------------------------------------------------------------
// Part 1 — every association in the real barrel
// ---------------------------------------------------------------------------

// The barrel exports some models under two keys (User and Users); walk each
// model once.
const allModels = [...new Set(Object.values(models).filter((m) => m && m.associations))];
const cases = [];
for (const source of allModels) {
  for (const association of Object.values(source.associations)) {
    cases.push([`${source.name}.${association.as} -> ${association.target.name}`, source, association]);
  }
}

const VARIANTS = [
  ["implicit (no required, no where)", (as) => ({ association: as })],
  ["required: false", (as) => ({ association: as, required: false })],
  ["required: true", (as) => ({ association: as, required: true })],
];

describe("A-87 Part 1 — every association in the models barrel", () => {
  it("walks a meaningful number of associations (the barrel loaded)", () => {
    expect(cases.length).toBeGreaterThan(100);
    expect(cases.filter(([, , a]) => tenantScope.tenantKeyOf(a.target)).length).toBeGreaterThan(50);
  });

  describe.each(cases)("%s", (_name, source, association) => {
    const alias = association.as;
    const target = association.target;

    it.each(VARIANTS)(
      "%s: the join type is the no-hook baseline and a tenant-scoped target carries the tenant in its ON clause",
      async (_v, build) => {
        // Baseline: no tenant context, so the hooks skip — this is exactly
        // the SQL Sequelize generates on its own.
        await source.findAll({ include: [build(alias)] });
        const baseline = joinOf(lastSelect(), association);

        await asTenant(() => source.findAll({ include: [build(alias)] }));
        const scoped = joinOf(lastSelect(), association);

        expect({ alias, type: scoped.type }).toEqual({ alias, type: baseline.type });

        const targetPredicate = predicateFor(target, alias, TENANT);
        if (targetPredicate) {
          expect({ alias, on: scoped.on.includes(targetPredicate) }).toEqual({ alias, on: true });
          expect(baseline.on).not.toContain(targetPredicate);
        } else {
          expect(scoped.on).toBe(baseline.on);
        }

        if (association.through) {
          const through = association.through.model;
          const throughPredicate = predicateFor(through, `${alias}->${through.name}`, TENANT);
          if (throughPredicate) {expect(scoped.on).toContain(throughPredicate);}
        }
      },
    );

    it("super admin and system work add nothing: the SQL is the no-context SQL", async () => {
      await source.findAll({ include: [{ association: alias }] });
      const baseline = lastSelect();

      await tenantStorage.run({ tenantId: TENANT, isSuperAdmin: true }, () =>
        source.findAll({ include: [{ association: alias }] }),
      );
      expect(lastSelect()).toBe(baseline);

      await tenantStorage.run({ tenantId: TENANT, isSystemTask: true }, () =>
        source.findAll({ include: [{ association: alias }] }),
      );
      expect(lastSelect()).toBe(baseline);
    });
  });
});

// ---------------------------------------------------------------------------
// Part 2 — named behaviours on the real models
// ---------------------------------------------------------------------------

const { CalibrationDevice, Capa, NonConformance, User } = models;

describe("A-87 Part 2 — named behaviours", () => {
  it("an include of a tenant-scoped model carries the tenant predicate", async () => {
    await asTenant(() =>
      NonConformance.findAll({
        include: [{ model: CalibrationDevice, as: "device", required: false }],
      }),
    );
    const device = joinOf(lastSelect(), NonConformance.associations.device);
    expect(device.on).toContain(`"device"."tenant_id" = '${TENANT}'`);
  });

  it("a hook-added predicate does not turn a LEFT JOIN into an INNER JOIN", async () => {
    // Capa -> nonConformance: NonConformance has no defaultScope where, so an
    // implicit include is a LEFT JOIN. A naive `include.where = { tenantId }`
    // would make Sequelize default it to required (INNER) and silently drop
    // every CAPA without an NC.
    await asTenant(() => Capa.findAll({ include: ["nonConformance"] }));
    const nc = joinOf(lastSelect(), Capa.associations.nonConformance);

    expect(nc.type).toBe("LEFT OUTER");
    expect(nc.on).toContain(`"nonConformance"."tenant_id" = '${TENANT}'`);
  });

  it("an INNER JOIN the caller asked for stays INNER, predicate in its ON clause", async () => {
    await asTenant(() =>
      NonConformance.findAll({ include: [{ association: "reporter", required: true }] }),
    );
    const reporter = joinOf(lastSelect(), NonConformance.associations.reporter);
    expect(reporter.type).toBe("INNER");
    expect(reporter.on).toContain(`"reporter"."tenant_id" = '${TENANT}'`);
  });

  it("nested includes are scoped at every level", async () => {
    await asTenant(() =>
      Capa.findAll({
        include: [
          {
            association: "nonConformance",
            required: false,
            include: [{ model: CalibrationDevice, as: "device", required: false }],
          },
        ],
      }),
    );
    const sql = lastSelect();
    expect(sql).toMatch(
      new RegExp(`LEFT OUTER JOIN "calibration_devices" AS "nonConformance->device" ON .*"nonConformance->device"."tenant_id" = '${TENANT}'`),
    );
    expect(sql).toContain(`"nonConformance"."tenant_id" = '${TENANT}'`);
    expect(sql).not.toMatch(/INNER JOIN/);
  });

  it("an include's own where is kept and the tenant is forced over its tenant key", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    await asTenant(() =>
      NonConformance.findAll({
        include: [
          {
            model: CalibrationDevice,
            as: "device",
            required: false,
            where: { tenantId: OTHER, [Op.or]: [{ status: "active" }, { status: "inactive" }] },
          },
        ],
      }),
    );
    const device = joinOf(lastSelect(), NonConformance.associations.device);
    expect(device.on).toContain(`"device"."tenant_id" = '${TENANT}'`);
    expect(device.on).not.toContain(OTHER);
    expect(device.on).toMatch(/"device"."status" = 'active' OR "device"."status" = 'inactive'/);
    expect(device.type).toBe("LEFT OUTER");
  });

  it("a non-plain where (sequelize.where) is AND-ed, never replaced", async () => {
    const db = NonConformance.sequelize;
    await asTenant(() =>
      NonConformance.findAll({
        include: [
          {
            model: CalibrationDevice,
            as: "device",
            required: false,
            where: db.where(db.fn("lower", db.col("device.name")), "scale"),
          },
        ],
      }),
    );
    const device = joinOf(lastSelect(), NonConformance.associations.device);
    expect(device.on).toContain("lower(\"device\".\"name\") = 'scale'");
    expect(device.on).toContain(`"device"."tenant_id" = '${TENANT}'`);
  });

  it("a principal with no resolvable tenant joins nothing (deny)", async () => {
    await tenantStorage.run({ tenantId: null }, () =>
      NonConformance.findAll({ include: [{ association: "device", required: false }] }),
    );
    const device = joinOf(lastSelect(), NonConformance.associations.device);
    expect(device.on).toContain(`"device"."tenant_id" = '${NO_TENANT_UUID}'`);
  });

  it("skipTenantScope on the root options skips the includes too (mirrors the root)", async () => {
    await asTenant(() =>
      NonConformance.findAll({ skipTenantScope: true, include: ["device"] }),
    );
    expect(lastSelect()).not.toMatch(/tenant_id" = '/);
  });

  it("count and findAndCountAll scope their includes", async () => {
    await asTenant(() => NonConformance.count({ include: [{ association: "device", required: true }] }));
    expect(lastCount()).toMatch(
      new RegExp(`INNER JOIN "calibration_devices" AS "device" ON .*"device"."tenant_id" = '${TENANT}'`),
    );

    mockSql.statements = [];
    await asTenant(() =>
      NonConformance.findAndCountAll({ include: [{ association: "reporter", required: true }], limit: 5 }),
    );
    expect(lastCount()).toContain(`"reporter"."tenant_id" = '${TENANT}'`);
    expect(lastSelect()).toContain(`"reporter"."tenant_id" = '${TENANT}'`);
  });

  it("a { model, as } include resolves the same way as an alias", async () => {
    await asTenant(() => NonConformance.findAll({ include: [{ model: User, as: "reporter", required: false }] }));
    expect(joinOf(lastSelect(), NonConformance.associations.reporter).on).toContain(
      `"reporter"."tenant_id" = '${TENANT}'`,
    );

    // Tenant is not tenant-scoped: nothing is added to its join.
    await asTenant(() => User.findAll({ include: [{ model: models.Tenant, as: "tenant" }] }));
    expect(joinOf(lastSelect(), User.associations.tenant).on).not.toContain("tenant_id\" = '");
  });

  it("an include Sequelize cannot resolve still fails with Sequelize's own error", async () => {
    await expect(
      asTenant(() => NonConformance.findAll({ include: [{ model: models.Vendor }] })),
    ).rejects.toThrow(/not associated/);
  });
});

// ---------------------------------------------------------------------------
// Part 3 — shapes the real barrel does not have
// ---------------------------------------------------------------------------

describe("A-87 Part 3 — through, separate, include-level opt-out", () => {
  const T = TENANT;
  let db;
  let Doc;
  let Tag;
  let DocTag;
  let Note;
  let statements;
  let rowsFor;

  beforeAll(() => {
    db = new Sequelize({ dialect: "postgres", logging: false });
    tenantScope.register(db);
    const common = { timestamps: false, underscored: true };
    const tenantId = { type: DataTypes.UUID, allowNull: false };
    Doc = db.define("Doc", { id: { type: DataTypes.UUID, primaryKey: true }, tenantId, title: DataTypes.STRING }, { ...common, tableName: "docs" });
    Tag = db.define("Tag", { id: { type: DataTypes.UUID, primaryKey: true }, tenantId }, { ...common, tableName: "tags" });
    DocTag = db.define("DocTag", { id: { type: DataTypes.UUID, primaryKey: true }, tenantId, role: DataTypes.STRING }, { ...common, tableName: "doc_tags" });
    Note = db.define("Note", { id: { type: DataTypes.UUID, primaryKey: true }, tenantId, docId: DataTypes.UUID }, { ...common, tableName: "notes" });
    Doc.belongsToMany(Tag, { through: DocTag, as: "tags", foreignKey: "docId", otherKey: "tagId" });
    Doc.hasMany(Note, { as: "notes", foreignKey: "docId" });
    Note.belongsTo(Tag, { as: "tag", foreignKey: "docId", constraints: false });
    // Un-aliased: the only shape a bare-model include resolves (every real
    // association is aliased).
    Tag.hasMany(Note, { foreignKey: "docId", constraints: false });
  });

  beforeEach(() => {
    statements = [];
    rowsFor = () => [];
    db.query = async (sql) => {
      const text = typeof sql === "string" ? sql : sql.query;
      statements.push(text);
      return rowsFor(text);
    };
  });

  it("a tenant-scoped through model is scoped, and the target too, on a LEFT JOIN", async () => {
    await tenantStorage.run({ tenantId: T }, () => Doc.findAll({ include: ["tags"] }));
    const sql = statements[0];
    expect(sql).toMatch(/LEFT OUTER JOIN \( "doc_tags"/);
    expect(sql).toContain(`"tags->DocTag"."tenant_id" = '${T}'`);
    expect(sql).toContain(`"tags"."tenant_id" = '${T}'`);
  });

  it("an existing through where is kept alongside the tenant", async () => {
    await tenantStorage.run({ tenantId: T }, () =>
      Doc.findAll({ include: [{ association: "tags", through: { where: { role: "primary" } } }] }),
    );
    expect(statements[0]).toContain("\"tags->DocTag\".\"role\" = 'primary'");
    expect(statements[0]).toContain(`"tags->DocTag"."tenant_id" = '${T}'`);
  });

  it("a separate include runs as its own root query, scoped by the root hook", async () => {
    rowsFor = (text) =>
      /FROM "docs"/.test(text) ? [Doc.build({ id: "d1", tenantId: T }, { isNewRecord: false, raw: true })] : [];
    await tenantStorage.run({ tenantId: T }, () =>
      Doc.findAll({ include: [{ association: "notes", separate: true, include: ["tag"] }] }),
    );
    expect(statements[0]).not.toContain("notes");
    const separate = statements[1];
    expect(separate).toMatch(/FROM "notes" AS "Note"/);
    expect(separate).toMatch(new RegExp(`WHERE .*"Note"."tenant_id" = '${T}'`));
    // ...and its own includes are scoped by the walk on THAT query.
    expect(separate).toContain(`"tag"."tenant_id" = '${T}'`);
  });

  it("a hasMany include with a limit is separate too; with separate:false it is joined and scoped", async () => {
    rowsFor = (text) =>
      /FROM "docs"/.test(text) ? [Doc.build({ id: "d1", tenantId: T }, { isNewRecord: false, raw: true })] : [];
    await tenantStorage.run({ tenantId: T }, () =>
      Doc.findAll({ include: [{ association: "notes", limit: 2 }] }),
    );
    expect(statements[1]).toMatch(new RegExp(`WHERE .*"Note"."tenant_id" = '${T}'`));

    statements = [];
    await tenantStorage.run({ tenantId: T }, () =>
      Doc.findAll({ include: [{ association: "notes", separate: false }] }),
    );
    expect(statements[0]).toMatch(new RegExp(`LEFT OUTER JOIN "notes" AS "notes" ON .*"notes"."tenant_id" = '${T}'`));
  });

  it("skipTenantScope on an include opts that include (and only it) out", async () => {
    await tenantStorage.run({ tenantId: T }, () =>
      Doc.findAll({ include: [{ association: "notes", skipTenantScope: true }, "tags"] }),
    );
    expect(statements[0]).not.toContain("\"notes\".\"tenant_id\" = '");
    expect(statements[0]).toContain(`"tags"."tenant_id" = '${T}'`);
  });

  it("a bare model include is scoped", async () => {
    await tenantStorage.run({ tenantId: T }, () => Tag.findAll({ include: [Note] }));
    expect(statements[0]).toMatch(new RegExp(`LEFT OUTER JOIN "notes" AS "Notes" ON .*"Notes"."tenant_id" = '${T}'`));
  });

  it("include: [] and { all: true } are handled like Sequelize handles them", async () => {
    // findAll drops an empty include before its hooks; count hands it to
    // beforeCount as-is, and the walk must leave it to conform away.
    rowsFor = () => ({ count: 0 });
    await tenantStorage.run({ tenantId: T }, () => Doc.count({ include: [] }));
    expect(statements[0]).not.toMatch(/JOIN/);
    expect(statements[0]).toContain(`"Doc"."tenant_id" = '${T}'`);
    rowsFor = () => [];

    statements = [];
    await tenantStorage.run({ tenantId: T }, () => Doc.findAll({ include: [{ all: true }] }));
    expect(statements[0]).toContain(`"notes"."tenant_id" = '${T}'`);
    expect(statements[0]).toContain(`"tags"."tenant_id" = '${T}'`);
  });
});
