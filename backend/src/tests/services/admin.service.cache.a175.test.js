/**
 * A-175 — a super admin's status or flag change must not leave tenant.service's
 * caches serving the old row: `cacheKeys.tenant(id)` and
 * `cacheKeys.tenantByCode(code)` (600 s), the public branding (300 s, active
 * tenants only) and the `tenants:*` list pages. The invalidation runs AFTER
 * the commit — asserted by recording, at each call, whether the tenant row had
 * committed yet (auditLedger fixture, `cls: false`).
 */
const { createLedger } = require("../fixtures/auditLedger");

const TENANT_ID = "7c0e2d4a-1111-4a2b-9c3d-000000000a75";
const mockRef = { ledger: null, tenant: null, calls: [] };

const mockTenantRow = (fields) => {
  const row = { ...fields };
  row.changed = () => undefined;
  row.save = async (options) =>
    mockRef.ledger.write("tenants", { id: row.id, status: row.status, settings: row.settings }, options);
  return row;
};

const mockRecord = (op) => async (key) => {
  mockRef.calls.push({ op, key, afterCommit: mockRef.ledger.committed("tenants").length > 0 });
  return true;
};

jest.mock("../../models", () => ({
  Tenants: { findByPk: async () => mockRef.tenant },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/redis.service", () => ({
  del: (...args) => mockRecord("del")(...args),
  delPattern: (...args) => mockRecord("delPattern")(...args),
  cacheKeys: {
    tenant: (id) => `tenant:${id}`,
    tenantByCode: (code) => `tenant:code:${code}`,
  },
}));

const adminService = require("../../services/admin.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const EXPECTED_CALLS = [
  { op: "del", key: `tenant:${TENANT_ID}`, afterCommit: true },
  { op: "del", key: "tenant:code:RSUD", afterCommit: true },
  { op: "del", key: `tenant:branding:${TENANT_ID}`, afterCommit: true },
  { op: "delPattern", key: "tenants:*", afterCommit: true },
];

const CASES = [
  { name: "updateTenantStatus", run: () => adminService.updateTenantStatus(TENANT_ID, "suspended", actor) },
  { name: "updateTenantFlags", run: () => adminService.updateTenantFlags(TENANT_ID, { featureA: true }, actor) },
];

describe("A-175 — tenant status and flag changes invalidate the tenant caches after commit", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.tenant = mockTenantRow({ id: TENANT_ID, code: "RSUD", status: "active", settings: {} });
    mockRef.calls = [];
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ run }) => {
    it("clears the tenant row, by-code, branding and list caches, after the change commits", async () => {
      const result = await run();

      expect(result).toBe(mockRef.tenant);
      expect(mockRef.ledger.committed("tenants")).toHaveLength(1);
      expect(mockRef.calls).toEqual(EXPECTED_CALLS);
    });

    it("a rolled-back change leaves the caches alone", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed("tenants")).toEqual([]);
      expect(mockRef.calls).toEqual([]);
    });
  });

  it("an unknown tenant is 404 and touches no cache", async () => {
    mockRef.tenant = null;

    await expect(adminService.updateTenantStatus(TENANT_ID, "suspended", actor)).rejects.toMatchObject({ status: 404 });
    await expect(adminService.updateTenantFlags(TENANT_ID, { featureA: true }, actor)).rejects.toMatchObject({ status: 404 });

    expect(mockRef.calls).toEqual([]);
  });
});
