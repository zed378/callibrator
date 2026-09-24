/**
 * A-174 — admin.service#updateTenantFlags merged ANY key into
 * `tenants.settings`, including secret-named ones, and spread a non-object
 * `flags` key by key. The service now refuses both itself (a 400 naming the
 * key), so a direct caller is held to the same rule as the route.
 *
 * Effects against the auditLedger fixture (as admin.service.audit.a165.test.js):
 * a refused change commits nothing and writes no audit row.
 */
const { createLedger } = require("../fixtures/auditLedger");

const TENANT_ID = "7c0e2d4a-1111-4a2b-9c3d-000000000a74";
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

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const load = () => require("../../services/admin.service");

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.tenant = mockTenantRow({
    id: TENANT_ID,
    code: "HOSPA",
    status: "active",
    settings: { featureB: true },
  });
});

describe("A-174 — updateTenantFlags refuses what must not reach tenants.settings", () => {
  it.each([
    ["smtp_password", "smtp_password"],
    ["oidc_client_secret", "oidc_client_secret"],
    ["ai_api_key", "ai_api_key"],
    ["an OIDC client record", "oidc_rp_33333333-3333-4333-8333-333333333333"],
  ])("a %s key is a 400 naming it; nothing committed, no audit row", async (_name, key) => {
    const err = await load()
      .updateTenantFlags(TENANT_ID, { featureA: true, [key]: "plain" }, actor)
      .catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.message).toContain(key);
    expect(mockRef.ledger.committed("tenants")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(mockRef.tenant.settings).toEqual({ featureB: true });
  });

  it.each([
    ["a string", "ab"],
    ["an array", ["a", "b"]],
    ["a number", 3],
  ])("flags that are %s are a 400, not spread key by key", async (_name, flags) => {
    const err = await load().updateTenantFlags(TENANT_ID, flags, actor).catch((e) => e);

    expect(err.status).toBe(400);
    expect(mockRef.ledger.committed("tenants")).toEqual([]);
    expect(mockRef.tenant.settings).toEqual({ featureB: true });
  });

  it("a nested object value is a 400", async () => {
    const err = await load()
      .updateTenantFlags(TENANT_ID, { nested: { smtp_password: "x" } }, actor)
      .catch((e) => e);

    expect(err.status).toBe(400);
    expect(mockRef.ledger.committed("tenants")).toEqual([]);
  });

  it("null flags merge nothing and write nothing", async () => {
    const tenant = await load().updateTenantFlags(TENANT_ID, null, actor);

    expect(tenant.settings).toEqual({ featureB: true });
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("scalar flags still merge and are audited (A-165 unchanged)", async () => {
    const tenant = await load().updateTenantFlags(TENANT_ID, { featureA: true, tier: "gold" }, actor);

    expect(tenant.settings).toEqual({ featureB: true, featureA: true, tier: "gold" });
    expect(mockRef.ledger.auditRows()[0].changes).toEqual({
      operation: "UPDATE_TENANT_FLAGS",
      before: {},
      after: { featureA: true, tier: "gold" },
    });
  });
});

describe("A-174 — defence in depth: the audit row still masks a secret-named key", () => {
  it("if the flag check ever let one through, its value is never copied into audit_logs", async () => {
    let service;
    jest.isolateModules(() => {
      jest.doMock("../../validators/admin.validator", () => ({ tenantFlagsProblem: () => null }));
      service = require("../../services/admin.service");
    });
    mockRef.tenant.settings = { smtp_password: "old-plain" };

    await service.updateTenantFlags(TENANT_ID, { smtp_password: "new-plain" }, actor);

    const serialized = JSON.stringify(mockRef.ledger.auditRows());
    expect(serialized).not.toContain("old-plain");
    expect(serialized).not.toContain("new-plain");
    expect(mockRef.ledger.auditRows()[0].changes).toEqual({
      operation: "UPDATE_TENANT_FLAGS",
      before: { smtp_password: "[REDACTED]" },
      after: { smtp_password: "[REDACTED]" },
    });
  });
});
