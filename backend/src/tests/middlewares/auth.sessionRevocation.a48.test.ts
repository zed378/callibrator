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

import type { Request, Response } from "express";
import type { FindOptions } from "sequelize";
import type * as ModelsModule from "../../models";
import type authMiddleware from "../../middlewares/auth.middleware";
import type * as AuthServiceModule from "../../services/auth.service";
import type * as SessionServiceModule from "../../services/session.service";
import type * as JwtUtilModule from "../../utils/jwt.util";

interface MockRedisState {
  down: boolean;
  sets: { key: string; ttl: number }[];
  dels: string[];
}

interface MockRedisService {
  mockStore: Map<string, string>;
  mockState: MockRedisState;
  get: jest.Mock<Promise<unknown>, [string]>;
  set: jest.Mock<Promise<boolean>, [string, unknown, number]>;
  del: jest.Mock<Promise<boolean>, [string]>;
  cacheKeys: Record<string, unknown>;
}

jest.mock("../../services/redis.service", () => {
  const mockStore = new Map<string, string>();
  const mockState: MockRedisState = { down: false, sets: [], dels: [] };
  return {
    mockStore,
    mockState,
    get: jest.fn((key: string): Promise<unknown> => {
      if (mockState.down || !mockStore.has(key)) {
        return Promise.resolve(null);
      }
      const raw = mockStore.get(key);
      return Promise.resolve(raw ? JSON.parse(raw) as unknown : null);
    }),
    set: jest.fn((key: string, value: unknown, ttl: number): Promise<boolean> => {
      if (mockState.down) {
        return Promise.resolve(false);
      }
      mockState.sets.push({ key, ttl });
      mockStore.set(key, JSON.stringify(value));
      return Promise.resolve(true);
    }),
    del: jest.fn((key: string): Promise<boolean> => {
      if (mockState.down) {
        return Promise.resolve(false);
      }
      mockState.dels.push(key);
      mockStore.delete(key);
      return Promise.resolve(true);
    }),
    cacheKeys: {},
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { sequelize, Sessions } = require("../../models") as typeof ModelsModule;
const { auth } = require("../../middlewares/auth.middleware") as typeof authMiddleware;
const authService = require("../../services/auth.service") as typeof AuthServiceModule;
const sessionService = require("../../services/session.service") as typeof SessionServiceModule;
const redis = require("../../services/redis.service") as MockRedisService;
const { generateAccessToken } = require("../../utils/jwt.util") as typeof JwtUtilModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const USER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_USER_ID = "77777777-7777-4777-8777-777777777777";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// The `sessions` table's columns, written out rather than read from the model,
// so a migration / attribute mismatch fails the suite loudly.
const SESSION_COLUMNS = new Set<string>([
  "id",
  "user_id",
  "tenant_id",
  "impersonator_id",
  "auth_method",
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

interface PgError extends Error {
  code: string;
}

const pgUndefinedColumn = (column: string): PgError => {
  const err = new Error(`column "${column}" does not exist`) as PgError;
  err.code = "42703";
  return err;
};

const parseLiteral = (text: string): boolean | number | string => {
  const t = text.trim();
  if (t === "true") {
    return true;
  }
  if (t === "false") {
    return false;
  }
  const quoted = /^'(.*)'$/.exec(t);
  return quoted?.[1] ?? Number(t);
};

interface SessionRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  tenant_id?: string;
  token_hash?: string;
  is_revoked?: boolean;
  is_active?: boolean;
  is_deleted?: boolean;
  expired_at?: Date;
  revoked_reason?: string;
  revoked_at?: Date;
}

interface FakeSessionsDb {
  connection: {
    query: (
      sql: string,
      paramsOrCallback?: unknown[] | ((err: Error | null, result?: unknown) => void),
      cb?: (err: Error | null, result?: unknown) => void,
    ) => void;
  };
  table: Map<string, SessionRow>;
  statements: string[];
  seed: (row: Partial<SessionRow> & { id: string; user_id: string }) => void;
  sessionReads: () => number;
}

/**
 * A fake pg connection over an in-memory `sessions` table.
 */
const fakeSessionsDb = (): FakeSessionsDb => {
  const table = new Map<string, SessionRow>();
  const statements: string[] = [];

  const checkColumns = (identifiers: string[]): void => {
    for (const col of identifiers) {
      if (!SESSION_COLUMNS.has(col)) {
        throw pgUndefinedColumn(col);
      }
    }
  };

  const matches = (row: SessionRow, predicates: [string, string | number | boolean][]): boolean =>
    predicates.every(([col, value]) => {
      const cell = row[col];
      if (cell === null || cell === undefined) {
        return false;
      }
      const cellStr = typeof cell === "string" ? cell : typeof cell === "number" || typeof cell === "boolean" ? cell.toString() : "";
      return cellStr === String(value);
    });

  const select = (sql: string): { rows: unknown[]; rowCount: number } => {
    const m = /^SELECT (.+?) FROM "sessions" AS "Session"(?: WHERE (.+?))?(?: LIMIT \d+)?;$/.exec(sql);
    if (!m?.[1]) {
      throw new Error(`fake pg: unsupported SELECT: ${sql}`);
    }
    // Each item is `"col"`, `"Session"."col"`, optionally `AS "outputName"`.
    const items = m[1].split(", ").map((item) => {
      const im = /^(?:"Session"\.)?"([^"]+)"(?: AS "([^"]+)")?$/.exec(item.trim());
      if (!im?.[1]) {
        throw new Error(`fake pg: unsupported projection item: ${item}`);
      }
      return { column: im[1], as: im[2] ?? im[1] };
    });
    const projection = items.map((i) => i.column);
    const predicates: [string, string | number | boolean][] = m[2]
      ? m[2].split(" AND ").map((p) => {
        const pm = /^"Session"\."([^"]+)" = (.+)$/.exec(p.trim());
        if (!pm?.[1] || !pm[2]) {
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

  const update = (sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } => {
    const m = /^UPDATE "sessions" SET (.+?) WHERE (.+)$/.exec(sql);
    if (!m?.[1] || !m[2]) {
      throw new Error(`fake pg: unsupported UPDATE: ${sql}`);
    }
    const bind = (ref: string): unknown => params[Number(ref.slice(1)) - 1];
    const sets: [string, unknown][] = m[1].split(",").map((s) => {
      const sm = /^"([^"]+)"=(\$\d+)$/.exec(s.trim());
      if (!sm?.[1] || !sm[2]) {
        throw new Error(`fake pg: unsupported assignment: ${s}`);
      }
      return [sm[1], bind(sm[2])];
    });
    const predicates: [string, string | number | boolean][] = m[2].split(" AND ").map((p) => {
      const pm = /^"([^"]+)" = (\$\d+)$/.exec(p.trim());
      if (!pm?.[1] || !pm[2]) {
        throw new Error(`fake pg: unsupported predicate: ${p}`);
      }
      return [pm[1], bind(pm[2]) as string | number | boolean];
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
    query(
      sql: string,
      paramsOrCallback?: unknown[] | ((err: Error | null, result?: unknown) => void),
      cb?: (err: Error | null, result?: unknown) => void,
    ): void {
      const callback = (typeof paramsOrCallback === "function" ? paramsOrCallback : cb) as (
        err: Error | null,
        result?: unknown,
      ) => void;
      const values = typeof paramsOrCallback === "function" ? [] : (paramsOrCallback ?? []);
      statements.push(sql);
      try {
        if (sql.startsWith("SELECT")) {
          callback(null, select(sql));
          return;
        }
        if (sql.startsWith("UPDATE")) {
          callback(null, update(sql, values));
          return;
        }
        callback(null, { rows: [], rowCount: 0 });
      } catch (err) {
        callback(err as Error);
      }
    },
  };

  const seed = (row: Partial<SessionRow> & { id: string; user_id: string }): void => {
    table.set(row.id, {
      tenant_id: TENANT_ID,
      token_hash: `hash-${row.id}`,
      is_revoked: false,
      is_active: true,
      is_deleted: false,
      expired_at: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      ...row,
    });
  };

  const sessionReads = (): number =>
    statements.filter((s) => s.startsWith('SELECT "id", "user_id", "expired_at" FROM "sessions"')).length;

  return { connection, table, statements, seed, sessionReads };
};

let db: FakeSessionsDb;
interface PrincipalUser {
  id: string;
  tenantId: string;
  isActive: boolean;
  status: string;
  role: { name: string };
  tenant: { id: string; name: string; status: string };
}
let principal: PrincipalUser;

const tokenFor = (sid: string, userId = USER_ID): string =>
  generateAccessToken({ id: userId, email: "user@hospital.test", sid });

interface RequestResult {
  status: number | "next";
  message?: string;
  req: Request;
}

/**
 * Run one request through the real auth middleware.
 */
const request = (token: string, onNext?: (req: Request) => unknown): Promise<RequestResult> =>
  new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      params: {},
      body: {},
      query: {},
    } as unknown as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response & { status: jest.Mock; json: jest.Mock };
    void Promise.resolve(auth(req, res, () => {
      const p = onNext ? onNext(req) : undefined;
      void Promise.resolve(p).then(() => {
        resolve({ status: "next", req });
      });
    })).then(() => {
      if (res.status.mock.calls.length) {
        const statusCalls = res.status.mock.calls as [number][];
        const jsonCalls = res.json.mock.calls as [{ message: string }][];
        const statusArg = statusCalls[0]?.[0] ?? 500;
        const jsonArg = jsonCalls[0]?.[0]?.message ?? "";
        resolve({
          status: statusArg,
          message: jsonArg,
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
    .spyOn((sequelize as unknown as { connectionManager: { getConnection: () => Promise<unknown> } }).connectionManager, "getConnection")
    .mockResolvedValue(db.connection);
  jest
    .spyOn((sequelize as unknown as { connectionManager: { releaseConnection: () => void } }).connectionManager, "releaseConnection")
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
    .mockImplementation(() => Promise.resolve(principal as unknown as Awaited<ReturnType<typeof authService.getAuthUserWithTenant>>));
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
    const sessionARow = db.table.get(SESSION_A);
    expect(sessionARow?.is_revoked).toBe(true);
    expect(sessionARow?.revoked_reason).toBe("ADMIN_REVOKE");
  });

  it("a logged-out user's token stops working (POST /auth/logout calls logoutSession() with no arguments)", async () => {
    const token = tokenFor(SESSION_A);
    const other = tokenFor(SESSION_B);

    // The route chain: auth -> controller -> authService.logoutSession().
    const logout = await request(token, () => authService.logoutSession());
    expect(logout.status).toBe("next");
    const sessionARow = db.table.get(SESSION_A);
    expect(sessionARow?.revoked_reason).toBe("LOGOUT");

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
    const sessionAttrs = { id: SESSION_A, user_id: USER_ID, is_revoked: false, is_active: true };
    const row = Sessions.build(
      sessionAttrs as never,
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

    await sessionService.revokeAllSessions(USER_ID as never, "PASSWORD_CHANGED");

    expect((await request(a)).status).toBe(401);
    expect((await request(b)).status).toBe(401);
  });

  it("refresh-token rotation revokes the access token issued with the old session", async () => {
    const token = tokenFor(SESSION_A);
    expect((await request(token)).status).toBe("next");

    // revokeSession matches by token_hash — the hash of the REFRESH token.
    const sessionARow = db.table.get(SESSION_A);
    if (sessionARow) {
      sessionARow.token_hash = sessionService.hashToken("refresh-a");
    }
    await sessionService.revokeSession("refresh-a", "TOKEN_ROTATION");

    expect((await request(token)).status).toBe(401);
  });

  it("an expired session's token is rejected even though the JWT has not expired", async () => {
    const sessionARow = db.table.get(SESSION_A);
    if (sessionARow) {
      sessionARow.expired_at = new Date(Date.now() - 1000);
    }

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
      Sessions.findOne({ where: { isRevoked: false } as unknown as FindOptions["where"], skipTenantScope: true } as unknown as FindOptions),
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

  it("P6-12: a token that names no session is refused, without a session read — it could never be revoked", async () => {
    const legacy = generateAccessToken({ id: USER_ID, email: "user@hospital.test" });

    const res = await request(legacy);
    expect(res.status).toBe(401);
    expect(db.sessionReads()).toBe(0);
  });
});

describe("A-48: a suspended tenant stops its live sessions", () => {
  it("is refused on the next request, because the tenant is read with the user on every request", async () => {
    const token = tokenFor(SESSION_A);
    expect((await request(token)).status).toBe("next");

    principal.tenant.status = "suspended";

    const after = await request(token);
    expect(after.status).toBe(403);
    expect(after.message).toMatch(/Tenant account is suspended/);
  });
});
