/**
 * A-165 (ADR-051 Q-14, A-41) — a super admin's change to one tenant's status
 * or feature flags writes its audit rows inside the change's transaction:
 * one under the reserved PLATFORM tenant (the platform's trail), and one under
 * the AFFECTED tenant (so its own admins can see why they were suspended).
 *
 * Effects against the auditLedger fixture (real audit ENUM, NOT NULL columns,
 * migration 0033's actor CHECK, real rollback), with `cls: false` so every
 * write must carry `{ transaction }` explicitly — an unpassed write
 * autocommits and survives the rollback, and the test sees it.
 */
const { createLedger } = require("../fixtures/auditLedger");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const TENANT_ID = "7c0e2d4a-1111-4a2b-9c3d-000000000a65";
const mockRef = { ledger: null, tenant: null };

const mockTenantRow = (fields) => {
  const row = { ...fields };
  row.changed = () => undefined;
  row.save = async (options) =>
    mockRef.ledger.write("tenants", { id: row.id, status: row.status, settings: row.settings }, options);
  return row;
};

jest.mock("../../models", () => ({
  Tenants: { findByPk: async () => mockRef.tenant },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const adminService = require("../../services/admin.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const CASES = [
  {
    name: "updateTenantStatus (suspend)",
    run: () => adminService.updateTenantStatus(TENANT_ID, "suspended", actor),
    operation: "UPDATE_TENANT_STATUS",
    before: { status: "active" },
    after: { status: "suspended" },
  },
  {
    name: "updateTenantFlags",
    run: () => adminService.updateTenantFlags(TENANT_ID, { featureA: true, featureB: false }, actor),
    operation: "UPDATE_TENANT_FLAGS",
    before: { featureB: true },
    after: { featureA: true, featureB: false },
  },
];

describe("A-165 — a platform change to one tenant is audited under PLATFORM and in that tenant", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.tenant = mockTenantRow({
      id: TENANT_ID,
      status: "active",
      settings: { featureB: true, theme: "dark" },
    });
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ run, operation, before, after }) => {
    it("commits the change with one row under PLATFORM and one under the affected tenant, both naming the actor", async () => {
      await run();

      expect(mockRef.ledger.committed("tenants")).toHaveLength(1);
      const expected = {
        userId: "super-1",
        actorType: "user",
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: TENANT_ID,
        ipAddress: "10.0.0.7",
        userAgent: "UA",
        changes: { operation, before, after },
      };
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({ ...expected, tenantId: PLATFORM_TENANT_ID }),
        expect.objectContaining({ ...expected, tenantId: TENANT_ID }),
      ]);
    });

    it("never records it under the actor's home tenant (F-7)", async () => {
      await run();

      const tenants = mockRef.ledger.auditRows().map((r) => r.tenantId);
      expect(tenants).not.toContain(actor.tenantId);
    });

    it("a failing PLATFORM audit insert rolls the change back and leaves no row", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed("tenants")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a failing tenant-side audit insert rolls back the change AND the PLATFORM row", async () => {
      // Let the first (PLATFORM) insert through, fail the second.
      const create = mockRef.ledger.AuditLog.create;
      let calls = 0;
      mockRef.ledger.AuditLog.create = async (values, options) => {
        calls += 1;
        if (calls === 2) {mockRef.ledger.failNext("audit_logs", new Error("tenant-side insert failed"));}
        return create(values, options);
      };

      await expect(run()).rejects.toThrow("tenant-side insert failed");

      expect(mockRef.ledger.committed("tenants")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a rolled-back change leaves no audit row", async () => {
      mockRef.ledger.failNext("tenants", new Error("write failed"));

      await expect(run()).rejects.toThrow("write failed");

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("with no actor the change is refused, not committed unattributed (A-124)", async () => {
      const unattributed = operation === "UPDATE_TENANT_STATUS"
        ? () => adminService.updateTenantStatus(TENANT_ID, "suspended")
        : () => adminService.updateTenantFlags(TENANT_ID, { featureA: true });

      await expect(unattributed()).rejects.toThrow(/must name its actor/);

      expect(mockRef.ledger.committed("tenants")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });
  });

  it("a tenant that does not exist (or is PLATFORM, which the model hides) is 404 and writes nothing", async () => {
    mockRef.tenant = null;

    await expect(adminService.updateTenantStatus(PLATFORM_TENANT_ID, "suspended", actor)).rejects.toMatchObject({
      status: 404,
    });
    await expect(adminService.updateTenantFlags(PLATFORM_TENANT_ID, { a: true }, actor)).rejects.toMatchObject({
      status: 404,
    });

    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("an invalid status is 400 and writes nothing", async () => {
    await expect(adminService.updateTenantStatus(TENANT_ID, "bogus", actor)).rejects.toMatchObject({ status: 400 });

    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("setting the status a tenant already has changes nothing and writes no audit row", async () => {
    await adminService.updateTenantStatus(TENANT_ID, "active", actor);

    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("flags that change nothing write nothing and no audit row", async () => {
    await adminService.updateTenantFlags(TENANT_ID, { featureB: true, theme: "dark" }, actor);
    await adminService.updateTenantFlags(TENANT_ID, undefined, actor);

    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("records only the flags that changed, and keeps the rest of the settings", async () => {
    const tenant = await adminService.updateTenantFlags(TENANT_ID, { theme: "dark", featureC: 1 }, actor);

    expect(tenant.settings).toEqual({ featureB: true, theme: "dark", featureC: 1 });
    const [row] = mockRef.ledger.auditRows();
    expect(row.changes).toEqual({ operation: "UPDATE_TENANT_FLAGS", before: {}, after: { featureC: 1 } });
  });

  it("refuses a secret-named key outright — nothing written, no audit row (A-174)", async () => {
    // Before A-174 this was merged into tenants.settings and only MASKED in the
    // audit row; the masking is still tested (validator bypassed) in
    // admin.service.flags.a174.test.js.
    mockRef.tenant.settings = { smtp_password: "old-plain" };

    await expect(
      adminService.updateTenantFlags(TENANT_ID, { smtp_password: "new-plain" }, actor),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockRef.ledger.committed("tenants")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});
