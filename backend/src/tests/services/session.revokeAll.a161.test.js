/**
 * A-161 — session.service#revokeAllSessions revokes every live session of the
 * user it names, whatever tenant context the caller runs in.
 *
 * The bug: revokeAllSessions did not pass `skipTenantScope`, so the global
 * tenant hooks (utils/tenantScope.util.js) AND-ed the CALLER's tenant onto its
 * UPDATE:
 *  - a principal with no tenant that is not a super admin resolves to "deny",
 *    and the UPDATE carried `tenant_id = NO_TENANT_UUID` — its logout-all,
 *    password change and e-mail reset revoked NOTHING;
 *  - for a tenant user the UPDATE carried `tenant_id = <their tenant>`, so a
 *    session row whose tenant_id is NULL (written before sessions carried a
 *    tenant) or another tenant (a user since moved) survived.
 * A super admin was NOT affected: its context resolves to "skip".
 *
 * How this is proven: against the SQL Sequelize actually generates — the real
 * models barrel, the real Session model and the real global hooks, on an
 * UNCONNECTED PostgreSQL-dialect Sequelize whose `query` is a recorder (the
 * A-87 technique, tests/utils/tenantScope.includes.a87.test.js). The
 * expectation is the predicate in the UPDATE statement, not the options the
 * service passed, so it is not derived from the code under test.
 *
 * Fail-before (baseline 2a157f1): 6 of 8 fail — the "tenant-less principal"
 * and "tenant user" cases (the UPDATE contains the tenant predicate), the
 * three missing-id cases (no guard: a null id issued `user_id IS NULL`, an
 * undefined one a Sequelize error, an empty one an UPDATE), and the
 * revokeOtherSessions case (that
 * function did not exist yet at the baseline). The super-admin and
 * no-context cases pass there too: those contexts already skipped the scope.
 */

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  // Bind parameters ($1, $2 ...) are inlined so the statement reads as
  // PostgreSQL receives it.
  const literal = (v) =>
    v === null ? "NULL" : typeof v === "boolean" || typeof v === "number" ? String(v) : `'${v instanceof Date ? "<date>" : v}'`;
  db.query = async (sql, options = {}) => {
    const raw = typeof sql === "string" ? sql : sql.query;
    const bind = (typeof sql === "object" && Array.isArray(sql.bind) && sql.bind) || (Array.isArray(options.bind) && options.bind) || [];
    const text = raw.replace(/\$(\d+)/g, (m, n) => (bind.length >= Number(n) ? literal(bind[Number(n) - 1]) : m));
    mockSql.statements.push(text);
    if (/^UPDATE/i.test(text)) {
      return [[], 3];
    }
    return [];
  };
  return { db };
});

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { NO_TENANT_UUID } = require("../../utils/tenantScope.util");
const { revokeAllSessions, revokeOtherSessions } = require("../../services/session.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

const lastUpdate = () => [...mockSql.statements].reverse().find((s) => /^UPDATE "sessions"/i.test(s));
const whereOf = (sql) => sql.slice(sql.indexOf(" WHERE "));

const inContext = (ctx, fn) => tenantStorage.run(ctx, fn);

beforeEach(() => {
  mockSql.statements = [];
});

describe("A-161: revokeAllSessions is scoped by user, never by the caller's tenant", () => {
  it("a tenant-less principal that is not a super admin revokes its own sessions (was: tenant_id = NO_TENANT_UUID, nothing revoked)", async () => {
    await inContext({ tenantId: null, isSuperAdmin: false, isSystemTask: false }, () =>
      revokeAllSessions(USER_ID, "USER_REQUESTED"),
    );

    const where = whereOf(lastUpdate());
    expect(where).toContain(`"user_id" = '${USER_ID}'`);
    expect(where).toContain("\"is_revoked\" = false");
    expect(where).not.toContain("tenant_id");
    expect(where).not.toContain(NO_TENANT_UUID);
  });

  it("a tenant user's revocation reaches sessions whose tenant_id is NULL or another tenant (was: tenant_id = <caller's tenant>)", async () => {
    await inContext({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, () =>
      revokeAllSessions(USER_ID, "PASSWORD_CHANGED"),
    );

    const where = whereOf(lastUpdate());
    expect(where).toContain(`"user_id" = '${USER_ID}'`);
    expect(where).not.toContain("tenant_id");
  });

  it("a super admin was already unaffected (its context skips the scope) and still is", async () => {
    await inContext({ tenantId: TENANT, isSuperAdmin: true, isSystemTask: false }, () =>
      revokeAllSessions(USER_ID),
    );

    const sql = lastUpdate();
    expect(whereOf(sql)).not.toContain("tenant_id");
    expect(sql).toContain("\"revoked_reason\"='LOGOUT_ALL'");
    expect(sql).toContain("\"is_active\"=false");
  });

  it("outside any request context (refresh-token reuse, e-mail reset) the WHERE is the user alone", async () => {
    await revokeAllSessions(USER_ID, "TOKEN_MISMATCH");

    expect(whereOf(lastUpdate())).toBe(
      ` WHERE "is_deleted" = false AND "user_id" = '${USER_ID}' AND "is_revoked" = false`,
    );
  });

  it.each([[undefined], [null], [""]])(
    "refuses a missing user id (%p) before any SQL — user_id is the only predicate left",
    async (userId) => {
      await expect(revokeAllSessions(userId)).rejects.toThrow(/user id is required/);
      expect(mockSql.statements).toEqual([]);
    },
  );
});

describe("A-161: revokeOtherSessions (A-141) was already scoped by user only", () => {
  it("a tenant-less principal's UPDATE carries no tenant predicate", async () => {
    await inContext({ tenantId: null, isSuperAdmin: false, isSystemTask: false }, () =>
      revokeOtherSessions(USER_ID, "33333333-3333-4333-8333-333333333333", "MFA_DISABLED"),
    );

    const where = whereOf(lastUpdate());
    expect(where).toContain(`"user_id" = '${USER_ID}'`);
    expect(where).toContain("\"id\" != '33333333-3333-4333-8333-333333333333'");
    expect(where).not.toContain("tenant_id");
  });
});
