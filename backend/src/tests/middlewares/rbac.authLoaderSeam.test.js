/**
 * V-01 — the seam between the principal loader and `rbac`.
 *
 * `rbac([ROLE_NAMES.TENANT_ADMIN])` admits a tenant administrator ONLY through
 * the level comparison (`TENANT_ADMIN` is a logical tier, not a seeded role
 * name). The level comes from `req.user.role.roleLevel`, and `req.user` is
 * whatever `auth.service.getAuthUserWithTenant` projected. When that loader
 * selected `["id", "name", "description"]` the level was never loaded, every
 * tenant admin read as level 0, and sixteen routes silently became
 * SUPERADMIN-only.
 *
 * Nothing caught it because nothing crossed the seam:
 *   - `rbac.test.js` hand-builds `{ role: { role_level: 8 } }` — a principal
 *     Sequelize cannot produce;
 *   - `routeGuards.a02.test.js` mocks `rbac` to always call next();
 *   - the E2E suite logs in as SUPERADMIN, which short-circuits before any
 *     level is read.
 *
 * This test crosses it. Everything from the bearer token to the gate is real:
 * the real `auth` middleware verifies a real signed access token, calls the
 * real `getAuthUserWithTenant`, which runs the real `Users`/`Roles`/`Tenants`
 * models (underscored, with their real attribute→column mapping and default
 * scopes) through real Sequelize query generation and real result building,
 * and hands the resulting model instance to the real, unmocked `rbac`.
 *
 * The ONLY stub is the wire: the pg connection. The fake connection answers a
 * SELECT the way Postgres does — it returns exactly the columns the statement
 * names, under the aliases the statement gives them, read from a fixture that
 * holds every column of the row. A column the loader does not project is
 * therefore absent from the result, exactly as in production. (It does not
 * evaluate WHERE; there is one row per table. What it does not prove: that
 * Postgres itself executes the statement — that needs a database.)
 */

const { sequelize } = require("../../models");
const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { generateAccessToken } = require("../../utils/jwt.util");
const { ROLE_NAMES, ROLE_IDS, ROLE_LEVELS } = require("../../constants");

const USER_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";

// Every column of the three rows as they sit in the database (snake_case
// column names — what Postgres knows about, not the JS attribute names).
const rowsFor = (roleKey) => ({
  User: {
    id: USER_ID,
    email: "admin@hospital.test",
    tenant_id: TENANT_ID,
    role_id: ROLE_IDS[roleKey],
    is_active: true,
    status: "ACTIVE",
    is_deleted: false,
    created_at: new Date("2026-01-01"),
    updated_at: new Date("2026-01-01"),
  },
  role: {
    id: ROLE_IDS[roleKey],
    name: ROLE_NAMES[roleKey],
    description: ROLE_NAMES[roleKey],
    // What migration 0020 backfills and the seed writes.
    role_level: ROLE_LEVELS[roleKey],
    is_system: true,
    is_deleted: false,
  },
  tenant: {
    id: TENANT_ID,
    name: "RS Test",
    status: "active",
    is_deleted: false,
  },
});

/**
 * A fake pg client. For a SELECT it parses the projection list — each item is
 * `"<alias>"."<column>"` optionally followed by `AS "<outputName>"` — and
 * builds the result row from the fixture, so the result carries precisely the
 * projected columns.
 */
const fakeConnection = (fixture, statements) => ({
  query(sql, params, cb) {
    const callback = typeof params === "function" ? params : cb;
    statements.push(sql);
    const match = /^SELECT ([\s\S]+?) FROM /.exec(sql);
    if (!match) {
      return callback(null, { rows: [], rowCount: 0 });
    }
    const row = {};
    const item = /"([^"]+)"\."([^"]+)"(?: AS "([^"]+)")?/g;
    let m;
    while ((m = item.exec(match[1])) !== null) {
      const [, tableAlias, column, outputName] = m;
      const source = fixture[tableAlias] || {};
      row[outputName || column] =
        column in source ? source[column] : null;
    }
    return callback(null, { rows: [row], rowCount: 1 });
  },
});

const drive = async (roleKey, gateRoles) => {
  const statements = [];
  jest
    .spyOn(sequelize.connectionManager, "getConnection")
    .mockResolvedValue(fakeConnection(rowsFor(roleKey), statements));
  jest
    .spyOn(sequelize.connectionManager, "releaseConnection")
    .mockImplementation(() => undefined);

  const token = generateAccessToken({ id: USER_ID });
  const req = {
    headers: { authorization: `Bearer ${token}` },
    params: {},
    body: {},
    query: {},
    method: "GET",
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  // auth -> (tenant context) -> rbac -> terminal next, exactly as the route
  // chain `[auth, rbac([...]), handler]` runs them.
  const outcome = await new Promise((resolve) => {
    const gate = rbac(gateRoles);
    auth(req, res, () =>
      gate(req, res, (err) => resolve({ err })),
    ).then(() => {
      // auth answered on its own (401/403) without calling next.
      if (res.status.mock.calls.length) {
        resolve({ authStatus: res.status.mock.calls[0][0] });
      }
    });
  });

  return { outcome, req, statements };
};

describe("V-01 seam: real auth loader -> unmocked rbac([TENANT_ADMIN])", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a HEALTHCARE ADMIN loaded by getAuthUserWithTenant passes rbac([ROLE_NAMES.TENANT_ADMIN])", async () => {
    const { outcome, req, statements } = await drive("HEALTCARE_ADMIN", [
      ROLE_NAMES.TENANT_ADMIN,
    ]);

    // The principal is the loader's model instance, not a hand-built literal.
    expect(req.user).toBeInstanceOf(sequelize.models.User);
    expect(req.user.role).toBeInstanceOf(sequelize.models.Role);
    expect(req.user.role.name).toBe("HEALTHCARE ADMIN");

    // Passed the gate: next() with no error. Without the fix this is
    // { err: { status: 403, message: "Forbidden: Insufficient permissions" } }.
    expect(outcome).toEqual({ err: undefined });

    // Why it passed: the loader projected the level column under the
    // attribute rbac reads.
    const select = statements.find((s) => s.startsWith("SELECT"));
    expect(select).toMatch(/"role"\."role_level" AS "role\.roleLevel"/);
    expect(req.user.role.roleLevel).toBe(8);
  });

  it("a CALIBRATOR ADMIN loaded the same way also passes", async () => {
    const { outcome } = await drive("CALIBRATOR_ADMIN", [
      ROLE_NAMES.TENANT_ADMIN,
    ]);
    expect(outcome).toEqual({ err: undefined });
  });

  it("a ROOM USER loaded the same way is refused with 403", async () => {
    const { outcome, req } = await drive("ROOM_USER", [
      ROLE_NAMES.TENANT_ADMIN,
    ]);
    expect(req.user.role.roleLevel).toBe(3);
    expect(outcome.err).toEqual(
      expect.objectContaining({
        status: 403,
        message: "Forbidden: Insufficient permissions",
      }),
    );
  });
});
