/**
 * A-48 — revocation must revoke.
 *
 * `auth.middleware.js` used to state its scope as "RBAC Only - No Session
 * Validation": it verified the JWT and loaded the user, and nothing in the
 * request path read `sessions`. Revoking a session, logging out, or an
 * administrator terminating access changed a row no request consulted; the
 * access token kept working until its own `exp` (1d on the deployment).
 *
 * What is real here: the auth middleware, session.service (liveness check,
 * cache, the Session model hooks that invalidate it), authService.logoutSession,
 * the JWT signing/verification, the Session model and Sequelize's Postgres
 * query generation.
 *
 * What is faked, and how:
 *   - the pg wire. The fake connection holds a `sessions` table keyed by the
 *     table's REAL column names (snake_case) and answers the statements
 *     Sequelize generates. Like Postgres, it rejects any column it does not
 *     have — so code that queried `isRevoked` or `tenantId` on this model would
 *     fail here with `column "…" does not exist`, as it does in production. It
 *     evaluates only the `"col" = value AND …` predicates this code emits.
 *   - Redis, as an in-memory map behind the same helper API redis.service
 *     exposes (get/set/del, which answer null/false when Redis is not ready).
 *   - the user loader (`getAuthUserWithTenant`), which is a separate query and
 *     is covered by rbac.authLoaderSeam.test.js.
 *
 * What it does not prove: that Postgres executes the statements, or that a
 * real Redis round-trip behaves like the map. That needs a running server.
 */

jest.mock("../../services/redis.service", () => {
  const mockStore = new Map();
  const mockState = { down: false, sets: [], dels: [] };
  return {
    mockStore,
    mockState,
    get: jest.fn(async (key) => {
      if (mockState.down || !mockStore.has(key)) {
        return null;
      }
      return JSON.parse(mockStore.get(key));
    }),
    set: jest.fn(async (key, value, ttl) => {
      if (mockState.down) {
        return false;
      }
      mockState.sets.push({ key, ttl });
      mockStore.set(key, JSON.stringify(value));
      return true;
    }),
    del: jest.fn(async (key) => {
      if (mockState.down) {
        return false;
      }
      mockState.dels.push(key);
      mockStore.delete(key);
      return true;
    }),
    cacheKeys: {},
  };
});

const { sequelize, Sessions } = require("../../models");
const { auth } = require("../../middlewares/auth.middleware");
const authService = require("../../services/auth.service");
const sessionService = require("../../services/session.service");
const redis = require("../../services/redis.service");
const { generateAccessToken } = require("../../utils/jwt.util");

const USER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_USER_ID = "77777777-7777-4777-8777-777777777777";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// The `sessions` table's columns, written out rather than read from the model,
// so a model or code change that drifts to camelCase cannot pass by agreeing
// with itself.
const SESSION_COLUMNS = new Set([
  "id",
  "user_id",
  "tenant_id",
  "impersonator_id", // A-146, migration 0040-session-impersonator
  "token_hash",
  "ip_address",
  "user_agent",
  "device",
  "expired_at",
  "last_activity_at",
  "is_revoked",
  "is_active",
  "revoked_at",
  "revoked_reason",
  "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at",
]);

const pgUndefinedColumn = (column) => {
  const err = new Error(`column "${column}" does not exist`);
  err.code = "42703";
  return err;
};

const parseLiteral = (text) => {
  const t = text.trim();
  if (t === "true") {
    return true;
  }
  if (t === "false") {
    return false;
  }
  const quoted = /^'(.*)'$/.exec(t);
  return quoted ? quoted[1] : Number(t);
};

/**
 * A fake pg connection over an in-memory `sessions` table.
 */
const fakeSessionsDb = () => {
  const table = new Map();
  const statements = [];

  const checkColumns = (identifiers) => {
    for (const col of identifiers) {
      if (!SESSION_COLUMNS.has(col)) {
        throw pgUndefinedColumn(col);
      }
    }
  };

  const matches = (row, predicates) =>
    predicates.every(([col, value]) => {
      const cell = row[col];
      return value === null ? cell === null : String(cell) === String(value);
    });

  const select = (sql) => {
    const m = /^SELECT (.+?) FROM "sessions" AS "Session"(?: WHERE (.+?))?(?: LIMIT \d+)?;$/.exec(sql);
    if (!m) {
      throw new Error(`fake pg: unsupported SELECT: ${sql}`);
    }
    // Each item is `"col"`, `"Session"."col"`, optionally `AS "outputName"`.
    const items = m[1].split(", ").map((item) => {
      const im = /^(?:"Session"\.)?"([^"]+)"(?: AS "([^"]+)")?$/.exec(item.trim());
      if (!im) {
        throw new Error(`fake pg: unsupported projection item: ${item}`);
      }
      return { column: im[1], as: im[2] || im[1] };
    });
    const projection = items.map((i) => i.column);
    const predicates = m[2]
      ? m[2].split(" AND ").map((p) => {
        const pm = /^"Session"\."([^"]+)" = (.+)$/.exec(p.trim());
        if (!pm) {
          throw new Error(`fake pg: unsupported predicate: ${p}`);
        }
        return [pm[1], parseLiteral(pm[2])];
      })
      : [];
    checkColumns([...projection, ...predicates.map(([c]) => c)]);
    const rows = [...table.values()]
      .filter((row) => matches(row, predicates))
      .map((row) => Object.fromEntries(items.map((i) => [i.as, row[i.column]])));
    return { rows, rowCount: rows.length };
  };

  const update = (sql, params) => {
    const m = /^UPDATE "sessions" SET (.+?) WHERE (.+)$/.exec(sql);
    if (!m) {
      throw new Error(`fake pg: unsupported UPDATE: ${sql}`);
    }
    const bind = (ref) => params[Number(ref.slice(1)) - 1];
    const sets = m[1].split(",").map((s) => {
      const sm = /^"([^"]+)"=(\$\d+)$/.exec(s.trim());
      return [sm[1], bind(sm[2])];
    });
    const predicates = m[2].replace(/ RETURNING .*$/, "").split(" AND ").map((p) => {
      const pm = /^"([^"]+)" = (\$\d+)$/.exec(p.trim());
      return [pm[1], bind(pm[2])];
    });
    checkColumns([...sets.map(([c]) => c), ...predicates.map(([c]) => c)]);
    let count = 0;
    for (const row of table.values()) {
      if (matches(row, predicates)) {
        for (const [c, v] of sets) {
          row[c] = v;
        }
        count += 1;
      }
    }
    return { rows: [], rowCount: count };
  };

  const connection = {
    query(sql, params, cb) {
      const callback = typeof params === "function" ? params : cb;
      const values = typeof params === "function" ? [] : params;
      statements.push(sql);
      try {
        if (sql.startsWith("SELECT")) {
          return callback(null, select(sql));
        }
        if (sql.startsWith("UPDATE")) {
          return callback(null, update(sql, values));
        }
        return callback(null, { rows: [], rowCount: 0 });
      } catch (err) {
        return callback(err);
      }
    },
  };

  const seed = (row) =>
    table.set(row.id, {
      tenant_id: TENANT_ID,
      token_hash: `hash-${row.id}`,
      is_revoked: false,
      is_active: true,
      is_deleted: false,
      expired_at: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      ...row,
    });

  const sessionReads = () =>
    statements.filter((s) => s.startsWith('SELECT "id", "user_id", "expired_at" FROM "sessions"')).length;

  return { connection, table, statements, seed, sessionReads };
};

let db;
let principal;

const tokenFor = (sid, userId = USER_ID) =>
  generateAccessToken({ id: userId, email: "user@hospital.test", sid });

/**
 * Run one request through the real auth middleware.
 * @returns {Promise<{status: number|"next", message?: string, req: object}>}
 */
const request = (token, onNext) =>
  new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      params: {},
      body: {},
      query: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    auth(req, res, async () => {
      if (onNext) {
        await onNext(req);
      }
      resolve({ status: "next", req });
    }).then(() => {
      if (res.status.mock.calls.length) {
        resolve({
          status: res.status.mock.calls[0][0],
          message: res.json.mock.calls[0][0].message,
          req,
        });
      }
    });
  });

beforeEach(() => {
  redis.mockStore.clear();
  redis.mockState.down = false;
  redis.mockState.sets = [];
  redis.mockState.dels = [];
  db = fakeSessionsDb();
  jest
    .spyOn(sequelize.connectionManager, "getConnection")
    .mockResolvedValue(db.connection);
  jest
    .spyOn(sequelize.connectionManager, "releaseConnection")
    .mockImplementation(() => undefined);
  principal = {
    id: USER_ID,
    tenantId: TENANT_ID,
    isActive: true,
    status: "ACTIVE",
    role: { name: "TECHNICIAN" },
    tenant: { id: TENANT_ID, name: "RS Test", status: "active" },
  };
  jest
    .spyOn(authService, "getAuthUserWithTenant")
    .mockImplementation(async () => principal);
  db.seed({ id: SESSION_A, user_id: USER_ID });
  db.seed({ id: SESSION_B, user_id: USER_ID });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-48: a revoked session stops its access token", () => {
  it("a revoked session's access token is rejected on the next request", async () => {
    const token = tokenFor(SESSION_A);
    expect((await request(token)).status).toBe("next");

    await sessionService.revokeSessionById(SESSION_A, "ADMIN_REVOKE");

    const after = await request(token);
    expect(after.status).toBe(401);
    expect(after.message).toBe("Session has been revoked or has expired");
    expect(db.table.get(SESSION_A).is_revoked).toBe(true);
    expect(db.table.get(SESSION_A).revoked_reason).toBe("ADMIN_REVOKE");
  });

  it("a logged-out user's token stops working (POST /auth/logout calls logoutSession() with no arguments)", async () => {
    const token = tokenFor(SESSION_A);
    const other = tokenFor(SESSION_B);

    // The route chain: auth -> controller -> authService.logoutSession().
    const logout = await request(token, () => authService.logoutSession());
    expect(logout.status).toBe("next");
    expect(db.table.get(SESSION_A).revoked_reason).toBe("LOGOUT");

    expect((await request(token)).status).toBe(401);
    // Logout is this device only: the user's other session is untouched.
    expect((await request(other)).status).toBe("next");
  });

  it("revocation takes effect without waiting for the cache TTL — the admin revoke path (instance update, as session.controller.js does it)", async () => {
    const token = tokenFor(SESSION_A);
    expect((await request(token)).status).toBe("next");
    const key = sessionService.livenessKey(SESSION_A);
    expect(redis.mockStore.has(key)).toBe(true);
    expect(redis.mockState.sets).toEqual([
      { key, ttl: sessionService.SESSION_LIVENESS_TTL_SECONDS },
    ]);

    // session.controller.js#revokeSession: findByPk, then instance.update().
    const row = Sessions.build(
      { id: SESSION_A, user_id: USER_ID, is_revoked: false, is_active: true },
      { isNewRecord: false },
    );
    await row.update({
      is_revoked: true,
      revoked_at: new Date(),
      revoked_reason: "MANUAL_REVOKE",
      is_active: false,
    });

    // No time passes: the cached "live" answer was dropped by the model hook.
    expect(redis.mockState.dels).toContain(key);
    expect((await request(token)).status).toBe(401);
  });

  it("revoking all of a user's sessions (password change, logout-all) stops every one of their tokens", async () => {
    const a = tokenFor(SESSION_A);
    const b = tokenFor(SESSION_B);
    expect((await request(a)).status).toBe("next");
    expect((await request(b)).status).toBe("next");

    await sessionService.revokeAllSessions(USER_ID, "PASSWORD_CHANGED");

    expect((await request(a)).status).toBe(401);
    expect((await request(b)).status).toBe(401);
  });

  it("refresh-token rotation revokes the access token issued with the old session", async () => {
    const token = tokenFor(SESSION_A);
    expect((await request(token)).status).toBe("next");

    // revokeSession matches by token_hash — the hash of the REFRESH token.
    db.table.get(SESSION_A).token_hash = sessionService.hashToken("refresh-a");
    await sessionService.revokeSession("refresh-a", "TOKEN_ROTATION");

    expect((await request(token)).status).toBe(401);
  });

  it("an expired session's token is rejected even though the JWT has not expired", async () => {
    db.table.get(SESSION_A).expired_at = new Date(Date.now() - 1000);

    expect((await request(tokenFor(SESSION_A))).status).toBe(401);
    // Nothing is cached for a session with no time left.
    expect(redis.mockState.sets).toEqual([]);
  });

  it("a token whose sid names another user's session is rejected", async () => {
    db.seed({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", user_id: OTHER_USER_ID });

    const res = await request(
      tokenFor("cccccccc-cccc-4ccc-8ccc-cccccccccccc", USER_ID),
    );
    expect(res.status).toBe(401);
  });
});

describe("A-48: cost and failure behaviour", () => {
  it("a valid session passes and costs no database read when cached", async () => {
    const token = tokenFor(SESSION_A);

    expect((await request(token)).status).toBe("next");
    expect(db.sessionReads()).toBe(1);

    for (let i = 0; i < 3; i += 1) {
      expect((await request(token)).status).toBe("next");
    }
    expect(db.sessionReads()).toBe(1);
  });

  it("the liveness query uses the sessions table's snake_case columns", async () => {
    await request(tokenFor(SESSION_A));

    expect(db.statements).toContain(
      `SELECT "id", "user_id", "expired_at" FROM "sessions" AS "Session" WHERE "Session"."is_deleted" = false AND "Session"."id" = '${SESSION_A}' AND "Session"."is_revoked" = false AND "Session"."is_active" = true;`,
    );
  });

  it("the fake table rejects a camelCase column the way Postgres does", async () => {
    await expect(
      Sessions.findOne({ where: { isRevoked: false }, skipTenantScope: true }),
    ).rejects.toThrow('column "isRevoked" does not exist');
  });

  it("Redis down: every request reads the database, and revocation is still enforced", async () => {
    redis.mockState.down = true;
    const token = tokenFor(SESSION_A);

    expect((await request(token)).status).toBe("next");
    expect((await request(token)).status).toBe("next");
    expect(db.sessionReads()).toBe(2);

    await sessionService.revokeSessionById(SESSION_A);
    expect((await request(token)).status).toBe(401);
  });

  it("a token that names no session (issued before `sid`, or by the SSO callbacks) is not session-checked", async () => {
    const legacy = generateAccessToken({ id: USER_ID, email: "user@hospital.test" });

    const res = await request(legacy);
    expect(res.status).toBe("next");
    expect(res.req.sessionId).toBeNull();
    expect(db.sessionReads()).toBe(0);
  });
});

describe("A-48: a suspended tenant stops its live sessions", () => {
  it("is refused on the next request, because the tenant is read with the user on every request", async () => {
    const token = tokenFor(SESSION_A);
    expect((await request(token)).status).toBe("next");

    principal.tenant.status = "suspended";

    const res = await request(token);
    expect(res.status).toBe(403);
    expect(res.message).toBe("Tenant account is suspended");
  });
});
