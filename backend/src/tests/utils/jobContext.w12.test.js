/**
 * W-12 — a background job declares its tenant context.
 *
 * The decisive test runs the REAL global isolation hooks
 * (utils/tenantScope.util.js) on a real, unconnected Sequelize model: a job
 * inside runForTenant(A) that writes a `where` with NO tenant predicate still
 * reads only tenant A, and a create inside it is stamped with tenant A. With
 * no context at all — how every job ran before — the hooks add nothing.
 */
const { Sequelize, DataTypes } = require("sequelize");
const { runForTenant, runAsSystem } = require("../../utils/jobContext.util");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { register: registerTenantScopeHooks } = require("../../utils/tenantScope.util");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("runForTenant / runAsSystem", () => {
  it("runForTenant runs fn in a plain tenant context and returns its result", async () => {
    const result = await runForTenant(TENANT_A, async () => tenantStorage.getStore());
    expect(result).toEqual({ tenantId: TENANT_A, isSuperAdmin: false, isSystemTask: false });
  });

  it("runForTenant refuses an empty tenant — a job with no tenant must say so", async () => {
    await expect(runForTenant(null, async () => 1)).rejects.toThrow(/runAsSystem/);
  });

  it("runAsSystem is an explicit, named system task and never a super admin", async () => {
    const result = await runAsSystem("test: cross-tenant read", async () => tenantStorage.getStore());
    expect(result).toEqual({
      tenantId: null,
      isSuperAdmin: false,
      isSystemTask: true,
      systemReason: "test: cross-tenant read",
    });
  });

  it("runAsSystem refuses an unnamed opt-out", async () => {
    await expect(runAsSystem("", async () => 1)).rejects.toThrow(/reason/);
  });
});

describe("W-12 — the isolation hooks apply inside runForTenant", () => {
  let Reading;
  let sequelize;

  beforeAll(() => {
    sequelize = new Sequelize({ dialect: "postgres", logging: false });
    registerTenantScopeHooks(sequelize);
    Reading = sequelize.define("Reading", {
      id: { type: DataTypes.UUID, primaryKey: true },
      tenantId: { type: DataTypes.UUID },
      value: { type: DataTypes.INTEGER },
    });
  });

  const whereOf = async (fn) => {
    let captured;
    const spy = jest.spyOn(sequelize.getQueryInterface(), "select").mockImplementation(async (model, table, options) => {
      captured = options.where;
      return [];
    });
    await fn();
    spy.mockRestore();
    return captured;
  };

  it("a hand-written where that forgets the tenant is confined to tenant A", async () => {
    const where = await whereOf(() => runForTenant(TENANT_A, () => Reading.findAll({ where: { value: 1 } })));
    expect(where).toEqual({ value: 1, tenantId: TENANT_A });
  });

  it("a where naming ANOTHER tenant is overridden to tenant A (forced, not trusted)", async () => {
    const where = await whereOf(() =>
      runForTenant(TENANT_A, () => Reading.findAll({ where: { tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } })),
    );
    expect(where).toEqual({ tenantId: TENANT_A });
  });

  it("with no context (the pre-W-12 background job) the hooks add nothing", async () => {
    const where = await whereOf(() => Reading.findAll({ where: { value: 1 } }));
    expect(where).toEqual({ value: 1 });
  });

  it("a create inside runForTenant is stamped with the tenant", async () => {
    const built = await runForTenant(TENANT_A, async () => {
      const instance = Reading.build({ id: "11111111-1111-4111-8111-111111111111", value: 3 });
      await Reading.runHooks("beforeCreate", instance, {});
      return instance;
    });
    expect(built.tenantId).toBe(TENANT_A);
  });
});
