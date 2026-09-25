/**
 * D-23 — hardDeleteOffboardedTenant: one transaction, and never a partial purge.
 *
 * It force-deleted users, subscriptions, invoices and settings in four
 * autocommits, then the tenant row, trusting CASCADE for the rest. Since 0030
 * a regulated table's tenant key is RESTRICT, so on real data it failed
 * part-way (users gone, the tenant and its records still there). Now it counts
 * every tenant-scoped table that is not CASCADE, refuses (409, naming them)
 * while any holds a row, and otherwise deletes in one transaction with an
 * audit row. The model list is the REAL models barrel — the enumeration is
 * over db.models, not a hand-written list — with count/destroy recorded.
 */

const mockCalls = { counts: {}, destroyed: [], audit: [], committed: false };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.transaction = async (cb) => {
    const out = await cb("TX");
    mockCalls.committed = true;
    return out;
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async (row, options) => mockCalls.audit.push({ row, options })),
}));

const models = require("../../models");
const { TENANT_FK_CASCADE } = require("../../migrations/0030-tenant-foreign-keys-restrict");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const tenantLifecycle = require("../../services/tenantLifecycle.service");

const TENANT = "0d230000-0000-4000-8000-000000000001";
const allModels = [...new Set(Object.values(models.sequelize.models))];
const scoped = allModels.filter((m) => (m.rawAttributes.tenantId || m.rawAttributes.tenant_id) && m.name !== "Tenant");

let tenantRow;
beforeEach(() => {
  jest.restoreAllMocks();
  mockCalls.counts = {};
  mockCalls.destroyed = [];
  mockCalls.audit = [];
  mockCalls.committed = false;
  tenantRow = {
    id: TENANT,
    name: "Closed Hospital",
    status: "deleted",
    offboardRetentionExpiresAt: new Date(Date.now() - 86400000),
    destroy: jest.fn(async (options) => mockCalls.destroyed.push(["tenants", options])),
  };
  jest.spyOn(models.Tenant, "findByPk").mockImplementation(async () => tenantRow);
  // Every scoped model: count() answers from mockCalls.counts[table] (0 by
  // default); destroy() records the call.
  for (const model of scoped) {
    jest.spyOn(model, "unscoped").mockReturnValue({
      count: jest.fn(async (options) => {
        expect(options).toMatchObject({ paranoid: false, skipTenantScope: true, transaction: "TX" });
        return mockCalls.counts[model.tableName] || 0;
      }),
      destroy: jest.fn(async (options) => {
        mockCalls.destroyed.push([model.tableName, options]);
        return 2;
      }),
    });
  }
});

describe("D-23 — hard delete of an offboarded tenant", () => {
  it("refuses (409) while any retained table holds a row — naming each, deleting nothing", async () => {
    mockCalls.counts = { audit_logs: 12, calibration_records: 3, certificates: 1 };

    const err = await tenantLifecycle.hardDeleteOffboardedTenant(TENANT, { userId: "super-1" }).catch((e) => e);

    expect(err).toMatchObject({ status: 409 });
    expect(err.message).toBe(
      "This tenant still holds records that are retained after offboarding: " +
        "audit_logs (12), calibration_records (3), certificates (1). " +
        "Nothing was deleted. Removing retained records is an archival decision, not part of this operation.",
    );
    expect(mockCalls.destroyed).toEqual([]);
    expect(mockCalls.audit).toEqual([]);
  });

  it("counts EVERY tenant-scoped table outside 0030's CASCADE list and its own delete list (enumerated from db.models)", async () => {
    await tenantLifecycle.hardDeleteOffboardedTenant(TENANT, { userId: "super-1" });

    const counted = scoped
      .filter((m) => m.unscoped.mock.results.some((r) => r.value.count.mock.calls.length > 0))
      .map((m) => m.tableName)
      .sort();
    const expected = scoped
      .map((m) => m.tableName)
      .filter((t) => !TENANT_FK_CASCADE.includes(t) && !["tenant_settings", "users", "subscriptions"].includes(t))
      .sort();
    expect(counted).toEqual(expected);
    // The regulated records are among them.
    expect(counted).toEqual(expect.arrayContaining(["audit_logs", "calibration_records", "certificates", "signature_records", "invoices"]));
  });

  it("with nothing retained: settings, users and subscriptions, then the tenant row, and one audit row — in one transaction", async () => {
    const res = await tenantLifecycle.hardDeleteOffboardedTenant(TENANT, { userId: "super-1", ipAddress: "10.0.0.1" });

    expect(res).toEqual({ tenantId: TENANT, deleted: { tenant_settings: 2, users: 2, subscriptions: 2 } });
    expect(mockCalls.destroyed.map(([t]) => t)).toEqual(["tenant_settings", "users", "subscriptions", "tenants"]);
    for (const [table, options] of mockCalls.destroyed.slice(0, 3)) {
      expect({ table, ...options }).toMatchObject({ table, force: true, skipTenantScope: true, transaction: "TX" });
    }
    expect(mockCalls.destroyed[3][1]).toEqual({ force: true, transaction: "TX" });
    expect(mockCalls.audit).toEqual([
      {
        row: expect.objectContaining({
          tenantId: PLATFORM_TENANT_ID,
          userId: "super-1",
          action: "DELETE",
          resourceType: "Tenant",
          resourceId: TENANT,
          ipAddress: "10.0.0.1",
          changes: {
            operation: "TENANT_HARD_DELETE",
            before: { name: "Closed Hospital", status: "deleted" },
            deleted: { tenant_settings: 2, users: 2, subscriptions: 2 },
          },
        }),
        options: { transaction: "TX" },
      },
    ]);
  });

  it("records the scheduler as the actor when no operator is named", async () => {
    await tenantLifecycle.hardDeleteOffboardedTenant(TENANT);

    expect(mockCalls.audit[0].row).toMatchObject({ systemActor: "system:tenant-lifecycle" });
    expect(mockCalls.audit[0].row.userId).toBeUndefined();
    expect(mockCalls.audit[0].row.changes.actor).toBe("system:tenant-lifecycle");
  });

  it("404 for an unknown tenant; 409 (not 400) for one not offboarded or still in retention", async () => {
    models.Tenant.findByPk.mockImplementationOnce(async () => null);
    await expect(tenantLifecycle.hardDeleteOffboardedTenant(TENANT)).rejects.toMatchObject({ status: 404 });

    tenantRow.status = "active";
    await expect(tenantLifecycle.hardDeleteOffboardedTenant(TENANT)).rejects.toMatchObject({
      status: 409,
      message: 'This tenant is "active", not offboarded: offboard it before it can be deleted',
    });

    tenantRow.status = "deleted";
    tenantRow.offboardRetentionExpiresAt = new Date(Date.now() + 86400000);
    await expect(tenantLifecycle.hardDeleteOffboardedTenant(TENANT)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("retention period runs until"),
    });
    expect(mockCalls.destroyed).toEqual([]);
  });

  it("a tenant with no retention date set is not held by it", async () => {
    tenantRow.offboardRetentionExpiresAt = null;

    await expect(tenantLifecycle.hardDeleteOffboardedTenant(TENANT)).resolves.toMatchObject({ tenantId: TENANT });
  });
});
