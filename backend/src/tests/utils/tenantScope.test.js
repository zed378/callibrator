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
        "beforeFind",
        "beforeCount",
        "beforeBulkUpdate",
        "beforeBulkDestroy",
        "beforeCreate",
        "beforeUpdate",
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

      const updated = {};
      registered.beforeUpdate.call(scopedCamel, updated, {});
      expect(updated.tenantId).toBe("t1");

      expect(() =>
        registered.beforeDestroy.call(scopedCamel, { tenantId: "t2" }, {}),
      ).toThrow("cross-tenant");
    });
  });
});
