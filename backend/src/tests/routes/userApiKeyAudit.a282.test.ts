/**
 * A-282 (ADR-094, ADR-100) — the user routes an API key can reach audit the
 * key as `system:api-key`, with the key's id in `changes.apiKeyId` and
 * `user_id` NULL.
 *
 * Before: user.controller built its actor with `auditActor(req)` and passed
 * `req.user.id` as `updatedBy` / `createdBy` / `deletedBy` / `actorId`, and
 * user.service wrote that id as the audit row's `userId`. For a key it is the
 * KEY's id, and `audit_logs.user_id` references `users` (migration 0030): on
 * PostgreSQL the row fails its foreign key and the write rolls back, so a key
 * scoped `users:update` could never edit a user. memoryDb enforces no foreign
 * key, so this suite asserts the row shape that satisfies it.
 *
 * REAL router, gates, controller, service, audit service and models over
 * fixtures/memoryDb; every role holds every menu (grantAllMenus).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TenantRow, TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";
import type * as UserRoutes from "../../routes/api/user.route";

const containing = (fields: Record<string, unknown>): unknown => expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
// The A-128 conflict budget lives in Redis; the limiter falls back to its
// in-memory store, which is what these tests read.

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const users = jest.requireActual<typeof UserRoutes>("../../routes/api/user.route");

/** The address seedTenants gives a principal's row. */
const seededEmail = (p: Principal): string => `${p.username}@${p.tenantId.slice(0, 8)}.test`;

const KEY_ID = "ab000000-0000-4000-8000-0000000000c3";

const apiKey = (tenant: TenantRow, scopes: string[]): Principal => ({
  id: KEY_ID,
  username: "integration",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: scopes,
});

let fx: TwoTenantWorld;
let admin: Principal;
let target: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  target = fx.principal(fx.tenantA, "TECHNICIAN");
  seedTenants(mdb, fx, [admin, target]);
});

/** The committed audit rows. */
const auditRows = (): Row[] => mdb.rows("AuditLog");

const byKey = (tenantId: string): Record<string, unknown> => ({
  tenantId,
  userId: null,
  actorType: "system",
  actorName: "system:api-key",
});

describe("A-282 — user writes made with an API key", () => {
  const key = (): Principal => apiKey(fx.tenantA, ["users:read", "users:write"]);

  it("PATCH /edit: the edit commits, audited as system:api-key naming the key", async () => {
    as(key());
    const res = await call(users, "PATCH", "/edit", { body: { userId: target.id, firstName: "Renamed" } });
    expect(res.status).toBe(200);
    expect(auditRows()).toEqual([
      containing({
        ...byKey(fx.tenantA.id),
        action: "UPDATE",
        resourceType: "User",
        resourceId: target.id,
        changes: containing({ apiKeyId: KEY_ID }),
      }),
    ]);
  });

  it("DELETE /delete: audited as system:api-key naming the key", async () => {
    as(key());
    const res = await call(users, "DELETE", "/delete", { query: { userId: target.id } });
    expect(res.status).toBe(200);
    expect(auditRows()).toEqual([
      containing({ ...byKey(fx.tenantA.id), action: "DELETE", changes: containing({ apiKeyId: KEY_ID }) }),
    ]);
  });

  it("DELETE /:userId/avatar on a user with an avatar: audited as system:api-key", async () => {
    // Re-seed the target with an avatar of its own (seedTenants writes none).
    mdb.reset();
    grantAllMenus();
    seedTenants(mdb, fx, [admin]);
    mdb.seed("User", {
      id: target.id,
      tenantId: target.tenantId,
      username: target.username,
      email: seededEmail(target),
      password: "not-a-hash",
      roleId: target.role.id,
      status: "ACTIVE",
      isActive: true,
      avatarUrl: "own-photo.png",
    });
    as(key());
    const res = await call(users, "DELETE", `/${target.id}/avatar`);
    expect(res.status).toBe(200);
    expect(auditRows()).toEqual([
      containing({ ...byKey(fx.tenantA.id), action: "UPDATE", changes: containing({ apiKeyId: KEY_ID }) }),
    ]);
  });

  it("an identity conflict refused to a key is audited as system:api-key, never with the key as the user", async () => {
    // A holder with no LIKE metacharacter in its address: A-128's lookup escapes `_` / `%`,
    // and fixtures/memoryDb evaluates LIKE without the escape.
    mdb.seed("User", {
      id: "cccccccc-cccc-4ccc-8ccc-0000000000ff",
      tenantId: fx.tenantB.id,
      username: "holder",
      email: "holder@elsewhere.test",
      password: "not-a-hash",
      roleId: target.role.id,
      status: "ACTIVE",
      isActive: true,
    });
    as(key());
    const res = await call(users, "PATCH", "/edit", { body: { userId: target.id, email: "holder@elsewhere.test" } });
    expect(res.status).toBe(409);
    expect(auditRows()).toEqual([
      containing({
        ...byKey(fx.tenantA.id),
        changes: containing({ operation: "IDENTITY_CONFLICT", apiKeyId: KEY_ID }),
      }),
    ]);
  });

  it("control: a user's edit is still recorded as that user, with no apiKeyId", async () => {
    as(admin);
    const res = await call(users, "PATCH", "/edit", { body: { userId: target.id, firstName: "Renamed" } });
    expect(res.status).toBe(200);
    const [row] = auditRows();
    expect(row).toMatchObject({ userId: admin.id, actorType: "user" });
    expect(row?.["changes"]).not.toHaveProperty("apiKeyId");
  });
});
