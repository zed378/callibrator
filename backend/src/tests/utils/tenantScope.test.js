/**
 * Tests for tenantScope.util — application-level tenant isolation.
 *
 * The security property under test: a tenant-scoped query must NEVER run
 * unfiltered for an authenticated principal that has no tenant. That was the
 * fail-open hole in both the old inline hooks and the RLS policy.
 */

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantStorage: { getStore: jest.fn() },
}));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const {
  NO_TENANT_UUID,
  tenantKeyOf,
  resolveScope,
  applyTenantWhere,
  applyTenantAssignment,
  applyTenantAssignmentBulk,
  assertUpsertTenant,
  assertSameTenant,
  register,
} = require("../../utils/tenantScope.util");

// Minimal model doubles.
const scopedCamel = { rawAttributes: { tenantId: {} } };
const scopedSnake = { rawAttributes: { tenant_id: {} } };
const unscoped = { rawAttributes: { id: {} } };

const asTenant = (tenantId) =>
  tenantStorage.getStore.mockReturnValue({ tenantId, isSuperAdmin: false });

describe("tenantScope.util", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantStorage.getStore.mockReturnValue(undefined);
  });

  describe("tenantKeyOf", () => {
    it("detects camelCase, snake_case, unscoped, and malformed models", () => {
      expect(tenantKeyOf(scopedCamel)).toBe("tenantId");
      expect(tenantKeyOf(scopedSnake)).toBe("tenant_id");
      expect(tenantKeyOf(unscoped)).toBeNull();
      expect(tenantKeyOf(undefined)).toBeNull();
      expect(tenantKeyOf({})).toBeNull();
    });
  });

  describe("resolveScope", () => {
    it("skips on an explicit opt-out", () => {
      asTenant("t1");
      expect(resolveScope({ skipTenantScope: true })).toEqual({ mode: "skip" });
    });

    it("skips when there is no context (pre-auth / public / migrations)", () => {
      expect(resolveScope({})).toEqual({ mode: "skip" });
    });

    it("skips for a system task", () => {
      tenantStorage.getStore.mockReturnValue({ isSystemTask: true });
      expect(resolveScope({})).toEqual({ mode: "skip" });
    });

    it("skips for a super admin (cross-tenant by design)", () => {
      tenantStorage.getStore.mockReturnValue({ isSuperAdmin: true });
      expect(resolveScope({})).toEqual({ mode: "skip" });
    });

    it("filters by the active tenant", () => {
      asTenant("t1");
      expect(resolveScope({})).toEqual({ mode: "filter", tenantId: "t1" });
    });

    it("DENIES an authenticated principal with no tenant (fail-closed)", () => {
      tenantStorage.getStore.mockReturnValue({ tenantId: null, isSuperAdmin: false });
      expect(resolveScope({})).toEqual({ mode: "deny" });
    });

    it("handles a missing options argument", () => {
      asTenant("t1");
      expect(resolveScope(undefined)).toEqual({ mode: "filter", tenantId: "t1" });
    });
  });

  describe("applyTenantWhere", () => {
    it("does nothing for an unscoped model", () => {
      asTenant("t1");
      const options = {};
      applyTenantWhere(options, unscoped);
      expect(options.where).toBeUndefined();
    });

    it("does nothing when the scope is skipped", () => {
      const options = {};
      applyTenantWhere(options, scopedCamel); // no context
      expect(options.where).toBeUndefined();
    });

    it("injects the tenant predicate, preserving existing conditions", () => {
      asTenant("t1");
      const options = { where: { status: "open" } };
      applyTenantWhere(options, scopedCamel);
      expect(options.where).toEqual({ status: "open", tenantId: "t1" });
    });

    it("creates the where clause when absent", () => {
      asTenant("t1");
      const options = {};
      applyTenantWhere(options, scopedCamel);
      expect(options.where).toEqual({ tenantId: "t1" });
    });

    it("uses the snake_case column when that is the model's shape", () => {
      asTenant("t1");
      const options = {};
      applyTenantWhere(options, scopedSnake);
      expect(options.where).toEqual({ tenant_id: "t1" });
    });

    it("FORCES isolation over a caller-supplied tenant (no cross-tenant reads)", () => {
      asTenant("t1");
      const options = { where: { tenantId: "someone-else" } };
      applyTenantWhere(options, scopedCamel);
      expect(options.where.tenantId).toBe("t1");
    });

    it("denies with an impossible-but-valid UUID when there is no tenant", () => {
      tenantStorage.getStore.mockReturnValue({ tenantId: null, isSuperAdmin: false });
      const options = {};
      applyTenantWhere(options, scopedCamel);
      // Valid UUID syntax so the DB returns zero rows instead of a type error.
      expect(options.where).toEqual({ tenantId: NO_TENANT_UUID });
      expect(NO_TENANT_UUID).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("applyTenantAssignment", () => {
    it("stamps the active tenant on create/update", () => {
      asTenant("t1");
      const instance = {};
      applyTenantAssignment(instance, scopedCamel, {});
      expect(instance.tenantId).toBe("t1");
    });

    it("ignores unscoped models", () => {
      asTenant("t1");
      const instance = {};
      applyTenantAssignment(instance, unscoped, {});
      expect(instance.tenantId).toBeUndefined();
    });

    it("does not stamp when there is no real tenant (skip or deny)", () => {
      const instance = {};
      applyTenantAssignment(instance, scopedCamel, {}); // no context -> skip
      expect(instance.tenantId).toBeUndefined();

      tenantStorage.getStore.mockReturnValue({ tenantId: null, isSuperAdmin: false });
      applyTenantAssignment(instance, scopedCamel, {}); // deny
      expect(instance.tenantId).toBeUndefined();
    });
  });

  // D-01: bulkCreate and upsert were outside the hooks entirely. These are the
  // inverse tests - each one fails against the seven-hook version of the util.
  describe("applyTenantAssignmentBulk (bulkCreate)", () => {
    it("stamps the active tenant on every row that carries none", () => {
      asTenant("t1");
      const rows = [{ key: "a" }, { key: "b" }];
      applyTenantAssignmentBulk(rows, scopedCamel, {});
      expect(rows.map((r) => r.tenantId)).toEqual(["t1", "t1"]);
    });

    it("REFUSES a row carrying another tenant's id (does not stamp over it)", () => {
      asTenant("tenant-a");
      const rows = [{ key: "a" }, { key: "b", tenantId: "tenant-b" }];
      expect(() => applyTenantAssignmentBulk(rows, scopedCamel, {})).toThrow(
        "Security Violation: Attempted to bulkCreate a cross-tenant record",
      );
      // The offending row is NOT quietly re-owned by tenant A.
      expect(rows[1].tenantId).toBe("tenant-b");
    });

    it("writes NOTHING for a principal with no resolvable tenant", () => {
      tenantStorage.getStore.mockReturnValue({ tenantId: null, isSuperAdmin: false });
      const rows = [{ key: "a" }];
      expect(() => applyTenantAssignmentBulk(rows, scopedCamel, {})).toThrow(
        "no resolvable tenant",
      );
      expect(rows[0].tenantId).toBeUndefined();
      expect(rows[0][NO_TENANT_UUID]).toBeUndefined();
    });

    it("uses the snake_case column when that is the model's shape (Session)", () => {
      asTenant("t1");
      const rows = [{}];
      applyTenantAssignmentBulk(rows, scopedSnake, {});
      expect(rows[0].tenant_id).toBe("t1");
      expect(rows[0].tenantId).toBeUndefined();
    });

    it("ignores unscoped models (Role, KanbanColumn, WorkflowStep, ...)", () => {
      asTenant("t1");
      const rows = [{ name: "SUPER_ADMIN" }];
      applyTenantAssignmentBulk(rows, unscoped, {});
      expect(rows[0].tenantId).toBeUndefined();
    });

    it("leaves the seed/system-task path alone (skip)", () => {
      // no context at all - migrations, schedulers, CLI seeding
      const rows = [{ tenantId: "whatever" }, { name: "x" }];
      expect(() => applyTenantAssignmentBulk(rows, scopedCamel, {})).not.toThrow();
      expect(rows[0].tenantId).toBe("whatever");
      expect(rows[1].tenantId).toBeUndefined();

      // explicit escape hatch
      asTenant("t1");
      const optOut = [{ tenantId: "someone-else" }];
      expect(() =>
        applyTenantAssignmentBulk(optOut, scopedCamel, { skipTenantScope: true }),
      ).not.toThrow();
      expect(optOut[0].tenantId).toBe("someone-else");

      // declared system task
      tenantStorage.getStore.mockReturnValue({ isSystemTask: true });
      const systemRows = [{ tenantId: "someone-else" }];
      expect(() =>
        applyTenantAssignmentBulk(systemRows, scopedCamel, {}),
      ).not.toThrow();
      expect(systemRows[0].tenantId).toBe("someone-else");

      // super admin, cross-tenant by design
      tenantStorage.getStore.mockReturnValue({ isSuperAdmin: true });
      const adminRows = [{ tenantId: "someone-else" }];
      expect(() =>
        applyTenantAssignmentBulk(adminRows, scopedCamel, {}),
      ).not.toThrow();
      expect(adminRows[0].tenantId).toBe("someone-else");
    });

    it("treats a null tenant id on a row as absent and stamps it", () => {
      asTenant("t1");
      const rows = [{ tenantId: null }];
      applyTenantAssignmentBulk(rows, scopedCamel, {});
      expect(rows[0].tenantId).toBe("t1");
    });

    it("survives an empty, absent or hole-y instance list", () => {
      asTenant("t1");
      expect(() => applyTenantAssignmentBulk([], scopedCamel, {})).not.toThrow();
      expect(() =>
        applyTenantAssignmentBulk(undefined, scopedCamel, {}),
      ).not.toThrow();
      const rows = [null, { key: "a" }];
      applyTenantAssignmentBulk(rows, scopedCamel, {});
      expect(rows[1].tenantId).toBe("t1");
    });

    it("re-adds the tenant column to an explicit `fields` list that omits it", () => {
      asTenant("t1");
      // Sequelize snapshots options.fields before the hook and builds the
      // INSERT column list from it; without this the stamp never lands.
      const options = { fields: ["key", "value"] };
      applyTenantAssignmentBulk([{}], scopedCamel, options);
      expect(options.fields).toEqual(["key", "value", "tenantId"]);

      const already = { fields: ["tenantId", "key"] };
      applyTenantAssignmentBulk([{}], scopedCamel, already);
      expect(already.fields).toEqual(["tenantId", "key"]);

      const noFields = {};
      applyTenantAssignmentBulk([{}], scopedCamel, noFields);
      expect(noFields.fields).toBeUndefined();

      expect(() =>
        applyTenantAssignmentBulk([{}], scopedCamel, undefined),
      ).not.toThrow();
    });
  });

  describe("assertUpsertTenant (upsert)", () => {
    it("allows an upsert whose values name the caller's own tenant", () => {
      asTenant("t1");
      expect(() =>
        assertUpsertTenant(
          { tenantId: "t1", key: "storage_credentials", value: "{}" },
          scopedCamel,
          {},
        ),
      ).not.toThrow();
    });

    it("REFUSES an upsert that would update another tenant's TenantSettings row", () => {
      // The D-01 case verbatim: the conflict target on tenant_settings is the
      // unique index (tenant_id, key), so a wrong tenant id does not collide -
      // it overwrites tenant B's storage credentials.
      asTenant("tenant-a");
      expect(() =>
        assertUpsertTenant(
          { tenantId: "tenant-b", key: "storage_credentials", value: "{}" },
          scopedCamel,
          {},
        ),
      ).toThrow("Security Violation: Attempted to upsert a cross-tenant record");
    });

    it("writes NOTHING for a principal with no resolvable tenant", () => {
      tenantStorage.getStore.mockReturnValue({ tenantId: null, isSuperAdmin: false });
      expect(() =>
        assertUpsertTenant({ tenantId: "tenant-b", key: "k" }, scopedCamel, {}),
      ).toThrow("no resolvable tenant");
    });

    it("refuses values with no tenant id at all (a hook cannot stamp an upsert)", () => {
      asTenant("t1");
      expect(() => assertUpsertTenant({ key: "k" }, scopedCamel, {})).toThrow(
        "Security Violation: Attempted to upsert a row with no tenant",
      );
      expect(() =>
        assertUpsertTenant({ tenantId: null, key: "k" }, scopedCamel, {}),
      ).toThrow("with no tenant");
      expect(() => assertUpsertTenant(undefined, scopedCamel, {})).toThrow(
        "with no tenant",
      );
    });

    it("uses the snake_case column when that is the model's shape", () => {
      asTenant("t1");
      expect(() =>
        assertUpsertTenant({ tenant_id: "t1" }, scopedSnake, {}),
      ).not.toThrow();
      expect(() =>
        assertUpsertTenant({ tenant_id: "t2" }, scopedSnake, {}),
      ).toThrow("cross-tenant");
    });

    it("ignores unscoped models", () => {
      asTenant("t1");
      expect(() => assertUpsertTenant({ name: "x" }, unscoped, {})).not.toThrow();
    });

    it("leaves the seed/system-task path alone (skip)", () => {
      // no context - migrations, schedulers, CLI seeding
      expect(() =>
        assertUpsertTenant({ tenantId: "anyone" }, scopedCamel, {}),
      ).not.toThrow();

      asTenant("t1");
      expect(() =>
        assertUpsertTenant({ tenantId: "someone-else" }, scopedCamel, {
          skipTenantScope: true,
        }),
      ).not.toThrow();

      tenantStorage.getStore.mockReturnValue({ isSystemTask: true });
      expect(() =>
        assertUpsertTenant({ tenantId: "someone-else" }, scopedCamel, {}),
      ).not.toThrow();

      // super admin: every TenantSettings.upsert route (feature flags, data
      // retention, tenant lifecycle) is superAdminOnly and lands here.
      tenantStorage.getStore.mockReturnValue({ isSuperAdmin: true });
      expect(() =>
        assertUpsertTenant({ tenantId: "someone-else" }, scopedCamel, {}),
      ).not.toThrow();
    });
  });

  describe("assertSameTenant", () => {
    it("allows destroying a row owned by the active tenant", () => {
      asTenant("t1");
      expect(() =>
        assertSameTenant({ tenantId: "t1" }, scopedCamel, {}),
      ).not.toThrow();
    });

    it("blocks destroying another tenant's row", () => {
      asTenant("t1");
      expect(() =>
        assertSameTenant({ tenantId: "t2" }, scopedCamel, {}),
      ).toThrow("cross-tenant");
    });

    it("ignores unscoped models and rows with no owner", () => {
      asTenant("t1");
      expect(() => assertSameTenant({}, unscoped, {})).not.toThrow();
      expect(() => assertSameTenant({}, scopedCamel, {})).not.toThrow();
      expect(() => assertSameTenant(null, scopedCamel, {})).not.toThrow();
    });

    it("does not police when the scope is skipped (super admin / system)", () => {
      tenantStorage.getStore.mockReturnValue({ isSuperAdmin: true });
      expect(() =>
        assertSameTenant({ tenantId: "t2" }, scopedCamel, {}),
      ).not.toThrow();
    });
  });

  describe("register", () => {
    it("wires every mutating and reading hook", () => {
      const db = { addHook: jest.fn() };
      register(db);

      const hooks = db.addHook.mock.calls.map(([name]) => name);
      expect(hooks).toEqual([
        "afterDefine",
        "beforeFind",
        "beforeCount",
        "beforeBulkUpdate",
        "beforeBulkDestroy",
        "beforeBulkRestore",
        "beforeRestore",
        "beforeCreate",
        "beforeBulkCreate",
        "beforeUpdate",
        "beforeUpsert",
        "beforeDestroy",
      ]);
    });

    it("bound hooks apply scoping with the model as `this`", () => {
      asTenant("t1");
      const registered = {};
      const db = { addHook: (name, fn) => { registered[name] = fn; } };
      register(db);

      const findOptions = {};
      registered.beforeFind.call(scopedCamel, findOptions);
      expect(findOptions.where).toEqual({ tenantId: "t1" });

      const countOptions = {};
      registered.beforeCount.call(scopedCamel, countOptions);
      expect(countOptions.where).toEqual({ tenantId: "t1" });

      const bulkUpdate = {};
      registered.beforeBulkUpdate.call(scopedCamel, bulkUpdate);
      expect(bulkUpdate.where).toEqual({ tenantId: "t1" });

      const bulkDestroy = {};
      registered.beforeBulkDestroy.call(scopedCamel, bulkDestroy);
      expect(bulkDestroy.where).toEqual({ tenantId: "t1" });

      const created = {};
      registered.beforeCreate.call(scopedCamel, created, {});
      expect(created.tenantId).toBe("t1");

      const bulkCreated = [{}, { tenantId: "t1" }];
      registered.beforeBulkCreate.call(scopedCamel, bulkCreated, {});
      expect(bulkCreated.map((r) => r.tenantId)).toEqual(["t1", "t1"]);
      expect(() =>
        registered.beforeBulkCreate.call(scopedCamel, [{ tenantId: "t2" }], {}),
      ).toThrow("cross-tenant");

      const updated = {};
      registered.beforeUpdate.call(scopedCamel, updated, {});
      expect(updated.tenantId).toBe("t1");

      expect(() =>
        registered.beforeUpsert.call(scopedCamel, { tenantId: "t1" }, {}),
      ).not.toThrow();
      expect(() =>
        registered.beforeUpsert.call(scopedCamel, { tenantId: "t2" }, {}),
      ).toThrow("cross-tenant");

      expect(() =>
        registered.beforeDestroy.call(scopedCamel, { tenantId: "t2" }, {}),
      ).toThrow("cross-tenant");
    });
  });
});
