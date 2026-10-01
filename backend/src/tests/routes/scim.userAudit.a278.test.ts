/**
 * A-278 (ADR-094) — every SCIM user write commits with one audit row, in the
 * write's own transaction.
 *
 * Before: only an identity conflict (A-37) was recorded; a create, a replace,
 * a patch (the IdP's deprovisioning) and a delete committed with nothing on
 * record. Now each writes one row in the credential's tenant:
 *  - an API key acts as `system:scim`, named in `changes.apiKeyId`;
 *  - a super admin's JWT acts as that user.
 * Role and status values are recorded; names and addresses are only named.
 *
 * REAL router, controller, scim service, audit service, models and tenant
 * hooks (fixtures/memoryDb), so "same transaction" is the write log's own
 * transaction id, not a mock's say-so.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type {
  Principal,
  TenantRow,
  TwoTenantWorld,
} from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/scim.route";

/** An asymmetric matcher, typed so it can sit inside an object literal. */
const containing = (fields: Record<string, unknown>): unknown =>
  expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest
    .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
    .memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
// The A-37 conflict budget lives in Redis; nothing here conflicts.
jest.mock("../../services/rateLimiter.redis.service", () => ({
  checkAuthLockout: () => Promise.resolve({ locked: false }),
  recordAuthFailure: () => Promise.resolve(undefined),
}));

const mdb = jest
  .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
  .memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<
  typeof RouteClient
>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>(
  "../../routes/api/scim.route",
);

const KEY_ID = "ab000000-0000-4000-8000-0000000000a1";

const apiKeyPrincipal = (tenant: TenantRow): Principal => ({
  id: KEY_ID,
  username: "scim-connector",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: ["scim:read", "scim:write"],
});

let fx: TwoTenantWorld;
let member: Principal;

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  member = fx.principal(fx.tenantA, "USER");
  seedTenants(mdb, fx, [member]);
});

/** The committed audit rows, and whether each shares a transaction with a committed User write. */
const audited = (): { rows: Record<string, unknown>[]; sameTx: boolean } => {
  const committed = mdb.committed();
  const auditTx = committed
    .filter((w) => w.model === "AuditLog")
    .map((w) => w.tx);
  const userTx = new Set(
    committed.filter((w) => w.model === "User").map((w) => w.tx),
  );
  return {
    rows: mdb.rows("AuditLog"),
    sameTx:
      auditTx.length > 0 &&
      auditTx.every((tx) => tx !== null && userTx.has(tx)),
  };
};

const byKey = {
  actorType: "system",
  actorName: "system:scim",
  userId: null,
  tenantId: "",
};

describe("A-278 — SCIM user writes are audited in their transaction", () => {
  it("POST /Users (API key): one CREATE row as system:scim naming the key", async () => {
    as(apiKeyPrincipal(fx.tenantA));
    const res = await call(router, "POST", "/Users", {
      body: {
        userName: "new.nurse@hospital-a.example.com",
        name: { givenName: "Nia" },
      },
    });

    expect(res.status).toBe(201);
    const { rows, sameTx } = audited();
    expect(rows).toEqual([
      expect.objectContaining({
        ...byKey,
        tenantId: fx.tenantA.id,
        action: "CREATE",
        resourceType: "User",
        changes: containing({
          operation: "SCIM_USER_CREATE",
          apiKeyId: KEY_ID,
        }),
      }),
    ]);
    expect(sameTx).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(
      "new.nurse@hospital-a.example.com",
    );
  });

  it("PUT /Users/:id (API key): one UPDATE row with the status before and after", async () => {
    as(apiKeyPrincipal(fx.tenantA));
    const res = await call(router, "PUT", `/Users/${member.id}`, {
      body: {
        userName: "nurse.a@hospital-a.example.com",
        name: { givenName: "Ana" },
        active: false,
      },
    });

    expect(res.status).toBe(200);
    const { rows, sameTx } = audited();
    expect(rows).toEqual([
      expect.objectContaining({
        ...byKey,
        tenantId: fx.tenantA.id,
        action: "UPDATE",
        resourceId: member.id,
        changes: containing({
          operation: "SCIM_USER_REPLACE",
          fields: ["firstName", "isActive", "status"],
          before: { isActive: true, status: "ACTIVE" },
          after: { isActive: false, status: "SUSPENDED" },
          apiKeyId: KEY_ID,
        }),
      }),
    ]);
    expect(sameTx).toBe(true);
  });

  it("PATCH /Users/:id (the IdP's deprovisioning): one UPDATE row", async () => {
    as(apiKeyPrincipal(fx.tenantA));
    const res = await call(router, "PATCH", `/Users/${member.id}`, {
      body: { Operations: [{ op: "replace", path: "active", value: false }] },
    });

    expect(res.status).toBe(200);
    const { rows, sameTx } = audited();
    expect(rows).toEqual([
      expect.objectContaining({
        action: "UPDATE",
        changes: containing({
          operation: "SCIM_USER_PATCH",
          after: { isActive: false, status: "SUSPENDED" },
        }),
      }),
    ]);
    expect(sameTx).toBe(true);
  });

  it("DELETE /Users/:id by the super admin's JWT: one DELETE row naming the operator", async () => {
    as(fx.superAdmin);
    const res = await call(router, "DELETE", `/Users/${member.id}`);

    expect(res.status).toBe(204);
    const { rows, sameTx } = audited();
    expect(rows).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        userId: fx.superAdmin.id,
        actorType: "user",
        action: "DELETE",
        resourceId: member.id,
        changes: { operation: "SCIM_USER_DELETE" },
      }),
    ]);
    expect(sameTx).toBe(true);
  });
});
