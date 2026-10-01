/**
 * A-324 — ending a session is audited, in the same transaction.
 *
 * `POST /sessions/:id/revoke`, `POST /sessions/user/:userId/revoke-all` and
 * `DELETE /sessions/:id` changed the sessions table and wrote no audit row: an
 * operator ending another user's sessions (incident response, P6-12) was
 * unattributable. Each now writes one row, in the session's tenant, naming the
 * actor, the target user and how many sessions ended — never token material —
 * inside the transaction of the change: if the audit insert fails, the
 * session is not ended either.
 *
 * REAL router, rbac, validate, controller, audit service, models and tenant
 * hooks over memoryDb; only `auth` installs the principal.
 * Fail-before: no AuditLog row was written for any of the three (and the
 * rollback case left the session revoked).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as SessionRoute from "../../routes/api/session.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof SessionRoute>("../../routes/api/session.route");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the models barrel, for one spy
const models = require("../../models") as { AuditLog: { create: (...args: unknown[]) => Promise<unknown> } };

const SESSION_1 = "a3240000-0000-4000-8000-000000000001";
const SESSION_2 = "a3240000-0000-4000-8000-000000000002";
const TOKEN_HASH_1 = "token-hash-secret-1";
const TOKEN_HASH_2 = "token-hash-secret-2";

let fx: ReturnType<typeof twoTenants>;
let target: ReturnType<ReturnType<typeof twoTenants>["principal"]>;

const session = (id: string, tokenHash: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  user_id: target.id,
  tenant_id: fx.tenantB.id,
  token_hash: tokenHash,
  expired_at: new Date(Date.now() + 3_600_000),
  is_revoked: false,
  is_active: true,
  is_deleted: false,
  ...extra,
});

beforeEach(() => {
  jest.restoreAllMocks();
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  target = fx.principal(fx.tenantB, "TECHNICIAN");
  seedTenants(mdb, fx, [fx.superAdmin, target]);
  mdb.seed("Session", [session(SESSION_1, TOKEN_HASH_1), session(SESSION_2, TOKEN_HASH_2)]);
  as(fx.superAdmin);
});

const auditRows = (): Record<string, unknown>[] => mdb.rows("AuditLog");

const expectNoTokenMaterial = (row: Record<string, unknown>): void => {
  const text = JSON.stringify(row);
  expect(text).not.toContain(TOKEN_HASH_1);
  expect(text).not.toContain(TOKEN_HASH_2);
  expect(text).not.toMatch(/token_?hash/i);
};

describe("A-324 — session revocation is audited", () => {
  it("revoke: one row in the session's tenant, naming the operator, the target user and the count", async () => {
    const res = await call(router, "POST", `/${SESSION_1}/revoke`, { body: { reason: "INCIDENT" } });
    expect(res.status).toBe(200);

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenantId: fx.tenantB.id,
      userId: fx.superAdmin.id,
      action: "UPDATE",
      resourceType: "session",
      resourceId: SESSION_1,
    });
    expect(row["changes"]).toMatchObject({ event: "SESSION_REVOKED", targetUserId: target.id, sessionCount: 1, reason: "INCIDENT" });
    expectNoTokenMaterial(row);
  });

  it("revoke-all: one row, in the target user's tenant, with the number of sessions ended", async () => {
    const res = await call(router, "POST", `/user/${target.id}/revoke-all`, { body: {} });
    expect(res.status).toBe(200);

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({ tenantId: fx.tenantB.id, userId: fx.superAdmin.id, action: "UPDATE", resourceType: "session", resourceId: target.id });
    expect(row["changes"]).toMatchObject({ event: "SESSIONS_REVOKED_ALL", targetUserId: target.id, sessionCount: 2 });
    expectNoTokenMaterial(row);
  });

  it("delete: one DELETE row for a revoked session", async () => {
    mdb.reset();
    grantAllMenus();
    seedTenants(mdb, fx, [fx.superAdmin, target]);
    mdb.seed("Session", session(SESSION_1, TOKEN_HASH_1, { is_revoked: true, is_active: false }));

    const res = await call(router, "DELETE", `/${SESSION_1}`);
    expect(res.status).toBe(200);

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({ tenantId: fx.tenantB.id, action: "DELETE", resourceType: "session", resourceId: SESSION_1 });
    expect(row["changes"]).toMatchObject({ event: "SESSION_DELETED", targetUserId: target.id, sessionCount: 1 });
    expectNoTokenMaterial(row);
  });

  it("if the audit insert fails, the session is NOT revoked (same transaction)", async () => {
    jest.spyOn(models.AuditLog, "create").mockRejectedValueOnce(new Error("audit insert failed"));

    const res = await call(router, "POST", `/${SESSION_1}/revoke`, { body: {} });
    expect(res.status).toBe(500);
    expect(mdb.rows("Session").find((row) => row["id"] === SESSION_1)?.["is_revoked"]).toBe(false);
    expect(auditRows()).toHaveLength(0);
  });
});
