/**
 * A-125 (ADR-051 Q-14) — the reserved PLATFORM tenant is not a customer.
 *
 * The REAL Tenant model, defined on an unconnected PostgreSQL-dialect
 * Sequelize. Only the network round-trip is stubbed: every SELECT/UPDATE
 * Sequelize generates is captured as SQL text and answered from two in-memory
 * rows (a hospital and PLATFORM) by honouring the generated `id` predicate.
 * The listing services (tenant.service fetchTenants, admin.service
 * getAllTenants, dashboard counts, the lifecycle scan) all read through this
 * model, so what the model returns is what every listing shows.
 *
 * What this cannot prove is PostgreSQL's answer to that SQL; the same checks
 * were run against pgvector/pgvector:pg18 (see the A-125 change record).
 */
const { Sequelize, DataTypes } = require("sequelize");
const { PLATFORM_TENANT_ID, PLATFORM_TENANT, isPlatformTenant } = require("../../constants/platformTenant");
const { NO_TENANT_UUID } = require("../../utils/tenantScope.util");

const HOSPITAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const Tenant = require("../../models/tenant.model")(sequelize, DataTypes);

const ROWS = [
  { id: HOSPITAL_ID, name: "Hospital A", code: "HOSP-A", status: "active", is_deleted: false },
  { id: PLATFORM_TENANT_ID, name: PLATFORM_TENANT.name, code: "PLATFORM", status: "active", is_deleted: false },
];

const statements = [];

/**
 * Answer a generated statement from ROWS: a row survives when the SQL does not
 * exclude its id (`"id" != '<id>'`) and, if the SQL pins an id or a code, it is
 * that one. Deliberately narrow — anything it does not model is visible in the
 * captured SQL the tests assert on.
 */
const answer = (sql) =>
  ROWS.filter((row) => {
    if (sql.includes(`"id" != '${row.id}'`)) {return false;}
    const pinnedId = /"Tenant"\."id" = '([^']+)'/.exec(sql);
    if (pinnedId && pinnedId[1] !== row.id) {return false;}
    const pinnedCode = /"Tenant"\."code" = '([^']+)'/.exec(sql);
    if (pinnedCode && pinnedCode[1] !== row.code) {return false;}
    return true;
  });

sequelize.query = async (statement, options = {}) => {
  const sql = typeof statement === "string" ? statement : statement.query;
  statements.push(sql);
  const rows = answer(sql);
  if (/SELECT count\(/i.test(sql)) {
    return options.plain ? { count: rows.length } : [{ count: rows.length }];
  }
  if (options.type === "UPDATE" || /^UPDATE/i.test(sql)) {
    return [undefined, rows.length];
  }
  return options.plain ? rows[0] || null : rows;
};

beforeEach(() => {
  statements.length = 0;
});

describe("A-125 — the PLATFORM tenant", () => {
  it("has a fixed, v4-shaped id that is not the deny sentinel", () => {
    expect(PLATFORM_TENANT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(PLATFORM_TENANT_ID).not.toBe(NO_TENANT_UUID);
    expect(PLATFORM_TENANT.id).toBe(PLATFORM_TENANT_ID);
    expect(Object.isFrozen(PLATFORM_TENANT)).toBe(true);
    expect(isPlatformTenant(PLATFORM_TENANT_ID)).toBe(true);
    expect(isPlatformTenant(HOSPITAL_ID)).toBe(false);
    expect(isPlatformTenant(null)).toBe(false);
    expect(isPlatformTenant(undefined)).toBe(false);
  });

  it("is a row the model itself accepts (the seed creates it through the model)", async () => {
    await expect(Tenant.build({ ...PLATFORM_TENANT }).validate()).resolves.toBeDefined();
  });

  it("the PLATFORM tenant is absent from tenant listings", async () => {
    const rows = await Tenant.findAll();
    const page = await Tenant.findAndCountAll({ limit: 10, offset: 0 });

    expect(rows.map((t) => t.id)).toEqual([HOSPITAL_ID]);
    expect(page.rows.map((t) => t.id)).toEqual([HOSPITAL_ID]);
    expect(page.count).toBe(1);
    for (const sql of statements) {
      expect(sql).toContain(`"Tenant"."id" != '${PLATFORM_TENANT_ID}'`);
    }
  });

  it("is absent from counts, including a filtered one (the dashboard's active count)", async () => {
    await expect(Tenant.count()).resolves.toBe(1);
    await expect(Tenant.count({ where: { status: "active" } })).resolves.toBe(1);
  });

  it("is absent from a search, even one that names it", async () => {
    const byCode = await Tenant.findOne({ where: { code: "PLATFORM" } });
    const byId = await Tenant.findByPk(PLATFORM_TENANT_ID);

    expect(byCode).toBeNull();
    expect(byId).toBeNull();
  });

  it("a query's own `id` cannot override the exclusion (it is AND-ed, not merged)", async () => {
    await Tenant.findAll({ where: { id: PLATFORM_TENANT_ID } });

    expect(statements[0]).toMatch(
      new RegExp(`"Tenant"\\."id" = '${PLATFORM_TENANT_ID}'.*AND "Tenant"\\."id" != '${PLATFORM_TENANT_ID}'`),
    );
  });

  it("unscoped() does not bring it back — the exclusion is a hook, not a scope", async () => {
    await expect(Tenant.unscoped().findByPk(PLATFORM_TENANT_ID)).resolves.toBeNull();
  });

  it("a bulk update (a suspend or offboard sweep) cannot reach it", async () => {
    await Tenant.update({ status: "suspended" }, { where: {} });

    expect(statements[0]).toMatch(/^UPDATE "tenants"/);
    expect(statements[0]).toContain(`"id" != '${PLATFORM_TENANT_ID}'`);
  });

  it("a bulk destroy cannot reach it", async () => {
    await Tenant.destroy({ where: { status: "suspended" } });

    expect(statements[0]).toContain(`"id" != '${PLATFORM_TENANT_ID}'`);
  });

  it("the seed and migration opt in explicitly with includePlatformTenant", async () => {
    const found = await Tenant.findByPk(PLATFORM_TENANT_ID, { includePlatformTenant: true });

    expect(found && found.id).toBe(PLATFORM_TENANT_ID);
    expect(statements[0]).not.toContain("!=");
  });
});
