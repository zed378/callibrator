/**
 * A-174 — admin.service#updateTenantFlags merged ANY key into
 * `tenants.settings`, including secret-named ones, and spread a non-object
 * `flags` key by key. The service now refuses both itself (a 400 naming the
 * key), so a direct caller is held to the same rule as the route.
 *
 * Effects against the auditLedger fixture (as admin.service.audit.a165.test.js):
 * a refused change commits nothing and writes no audit row.
 */
type LedgerRow = Record<string, unknown>;
interface Ledger {
    write: (table: string, row: LedgerRow, options?: unknown) => LedgerRow;
    committed: (table: string) => LedgerRow[];
    auditRows: () => LedgerRow[];
    transaction: (...args: unknown[]) => unknown;
    failNext: (table: string, error: Error) => void;
    AuditLog: { create: (...args: unknown[]) => unknown };
}

interface TenantRow {
    id: string;
    code: string;
    status: string;
    settings: Record<string, unknown>;
    changed: () => undefined;
    save: (options?: unknown) => Promise<LedgerRow>;
}

interface AdminService {
    updateTenantFlags: (tenantId: string, flags: unknown, actor: Record<string, unknown>) => Promise<TenantRow>;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { createLedger } = require("../fixtures/auditLedger") as {
    createLedger: (o: { cls: boolean }) => Ledger;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT_ID = "7c0e2d4a-1111-4a2b-9c3d-000000000a74";
const mockRef: { ledger: Ledger | null; tenant: TenantRow | null } = { ledger: null, tenant: null };

const ledger = (): Ledger => {
  if (!mockRef.ledger) {
    throw new Error("ledger not created");
  }
  return mockRef.ledger;
};

const mockTenantRow = (fields: {
    id: string;
    code: string;
    status: string;
    settings: Record<string, unknown>;
}): TenantRow => {
  const row = { ...fields };
  return {
    ...row,
    changed: () => undefined,
    save: (options?: unknown) =>
      Promise.resolve(ledger().write("tenants", { id: row.id, status: row.status, settings: row.settings }, options)),
  };
};

jest.mock("../../models", () => ({
  Tenants: { findByPk: (): Promise<unknown> => Promise.resolve(mockRef.tenant) },
  AuditLog: { create: (...args: unknown[]) => ledger().AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args: unknown[]) => ledger().transaction(...args) },
}));

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const load = (): AdminService => require("../../services/admin.service") as AdminService;
/* eslint-enable @typescript-eslint/no-require-imports */

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
  ])("a %s key is a 400 naming it; nothing committed, no audit row", async (_name: string, key: string) => {
    const err = (await load()
      .updateTenantFlags(TENANT_ID, { featureA: true, [key]: "plain" }, actor)
      .catch((e: unknown) => e)) as { status: number; message: string };

    expect(err.status).toBe(400);
    expect(err.message).toContain(key);
    expect(ledger().committed("tenants")).toEqual([]);
    expect(ledger().auditRows()).toEqual([]);
    expect(mockRef.tenant?.settings).toEqual({ featureB: true });
  });

  it.each([
    ["a string", "ab"],
    ["an array", ["a", "b"]],
    ["a number", 3],
  ])("flags that are %s are a 400, not spread key by key", async (_name: string, flags: unknown) => {
    const err = (await load().updateTenantFlags(TENANT_ID, flags, actor).catch((e: unknown) => e)) as {
            status: number;
        };

    expect(err.status).toBe(400);
    expect(ledger().committed("tenants")).toEqual([]);
    expect(mockRef.tenant?.settings).toEqual({ featureB: true });
  });

  it("a nested object value is a 400", async () => {
    const err = (await load()
      .updateTenantFlags(TENANT_ID, { nested: { smtp_password: "x" } }, actor)
      .catch((e: unknown) => e)) as { status: number };

    expect(err.status).toBe(400);
    expect(ledger().committed("tenants")).toEqual([]);
  });

  it("null flags merge nothing and write nothing", async () => {
    const tenant = await load().updateTenantFlags(TENANT_ID, null, actor);

    expect(tenant.settings).toEqual({ featureB: true });
    expect(ledger().auditRows()).toEqual([]);
  });

  it("scalar flags still merge and are audited (A-165 unchanged)", async () => {
    const tenant = await load().updateTenantFlags(TENANT_ID, { featureA: true, tier: "gold" }, actor);

    expect(tenant.settings).toEqual({ featureB: true, featureA: true, tier: "gold" });
    expect(ledger().auditRows()[0]?.["changes"]).toEqual({
      operation: "UPDATE_TENANT_FLAGS",
      before: {},
      after: { featureA: true, tier: "gold" },
    });
  });
});

describe("A-174 — defence in depth: the audit row still masks a secret-named key", () => {
  it("if the flag check ever let one through, its value is never copied into audit_logs", async () => {
    let service: AdminService | undefined;
    jest.isolateModules(() => {
      jest.doMock("../../validators/admin.validator", () => ({ tenantFlagsProblem: () => null }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- reloaded with the validator doubled, as the .js does
      service = require("../../services/admin.service") as AdminService;
    });
    if (mockRef.tenant) {
      mockRef.tenant.settings = { smtp_password: "old-plain" };
    }

    await (service as AdminService).updateTenantFlags(TENANT_ID, { smtp_password: "new-plain" }, actor);

    const serialized = JSON.stringify(ledger().auditRows());
    expect(serialized).not.toContain("old-plain");
    expect(serialized).not.toContain("new-plain");
    expect(ledger().auditRows()[0]?.["changes"]).toEqual({
      operation: "UPDATE_TENANT_FLAGS",
      before: { smtp_password: "[REDACTED]" },
      after: { smtp_password: "[REDACTED]" },
    });
  });
});
