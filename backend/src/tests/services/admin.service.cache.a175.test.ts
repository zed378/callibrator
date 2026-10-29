/**
 * A-175 — a super admin's status or flag change must not leave tenant.service's
 * caches serving the old row: `cacheKeys.tenant(id)` and
 * `cacheKeys.tenantByCode(code)` (600 s), the public branding (300 s, active
 * tenants only) and the `tenants:*` list pages. The invalidation runs AFTER
 * the commit — asserted by recording, at each call, whether the tenant row had
 * committed yet (auditLedger fixture, `cls: false`).
 */
import type * as ActivityLogModule from "../../middlewares/activityLog.middleware";

type LedgerRow = Record<string, unknown>;
interface Ledger {
    write: (table: string, row: LedgerRow, options?: unknown) => LedgerRow;
    committed: (table: string) => LedgerRow[];
    transaction: (...args: unknown[]) => unknown;
    failNext: (table: string, error: Error) => void;
    AuditLog: { create: (...args: unknown[]) => unknown };
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { createLedger } = require("../fixtures/auditLedger") as {
    createLedger: (o: { cls: boolean }) => Ledger;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT_ID = "7c0e2d4a-1111-4a2b-9c3d-000000000a75";
const mockRef: {
    ledger: Ledger | null;
    tenant: { id: string; code: string; status: string; settings: Record<string, unknown> } | null;
    calls: { op: string; key: string; afterCommit: boolean }[];
} = { ledger: null, tenant: null, calls: [] };

const ledger = (): Ledger => {
  if (!mockRef.ledger) {
    throw new Error("ledger not created");
  }
  return mockRef.ledger;
};

const mockTenantRow = (fields: { id: string; code: string; status: string; settings: Record<string, unknown> }) => {
  const row = { ...fields };
  return {
    ...row,
    changed: () => undefined,
    save: (options: unknown) =>
      Promise.resolve(ledger().write("tenants", { id: row.id, status: row.status, settings: row.settings }, options)),
  };
};

const mockRecord = (op: string) => (key: string) => {
  mockRef.calls.push({ op, key, afterCommit: ledger().committed("tenants").length > 0 });
  return Promise.resolve(true);
};

jest.mock("../../models", () => ({
  Tenants: { findByPk: () => Promise.resolve(mockRef.tenant) },
  AuditLog: { create: (...args: unknown[]) => ledger().AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args: unknown[]) => ledger().transaction(...args) },
}));
jest.mock("../../services/redis.service", () => ({
  del: (...args: unknown[]) => (mockRecord("del") as (...a: unknown[]) => unknown)(...args),
  delPattern: (...args: unknown[]) => (mockRecord("delPattern") as (...a: unknown[]) => unknown)(...args),
  cacheKeys: {
    tenant: (id: string) => `tenant:${id}`,
    tenantByCode: (code: string) => `tenant:code:${code}`,
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const adminService = require("../../services/admin.service") as {
    updateTenantStatus: (id: string, status: string, actor: Record<string, unknown>) => Promise<unknown>;
    updateTenantFlags: (id: string, flags: Record<string, unknown>, actor: Record<string, unknown>) => Promise<unknown>;
};
const { logger } = require("../../middlewares/activityLog.middleware") as typeof ActivityLogModule;
/* eslint-enable @typescript-eslint/no-require-imports */

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
      expect(ledger().committed("tenants")).toHaveLength(1);
      expect(mockRef.calls).toEqual(EXPECTED_CALLS);
    });

    it("a rolled-back change leaves the caches alone", async () => {
      ledger().failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(ledger().committed("tenants")).toEqual([]);
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
