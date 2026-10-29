/**
 * A-59 — tokens that are not access tokens must not be accepted as access
 * tokens, and every access token must be revocable.
 *
 * Before this change:
 *   - the account-ACTIVATION token (sent by email) was minted with
 *     generateAccessToken, so it carried typ "access" and the `auth` middleware
 *     accepted it as a bearer for the full JWT_ACCESS_EXPIRED;
 *   - the MFA-PENDING token was minted the same way. `auth` refused it only by
 *     its `mfaRequired` flag; `optionalAuth` and the activation route did not
 *     look, and the MFA route accepted any access token that carried the flag;
 *   - the SOCKET handshake token was jwt.sign()ed with no `typ`, which
 *     verifyAccessToken accepts, so it was a bearer access token too (A-52);
 *   - both SSO callbacks signed {id, email} with no `sid`, so revoking the
 *     session did nothing to the token (A-48 checks only tokens naming one).
 *
 * What is real here: jwt.util (signing, verification, `typ`), the `auth` and
 * `optionalAuth` middleware, authService.registerUser / loginUser /
 * activateAccount, the auth controller's activation / loginMfa / socketToken
 * handlers, the SSO controller's callbacks, the socket handshake, and
 * session.service (createSession, isSessionLive, revocation, the Session model
 * hooks) through Sequelize's PostgreSQL SQL generation.
 *
 * What is faked, and how:
 *   - the pg wire: an in-memory `sessions` table keyed by its REAL snake_case
 *     columns, which rejects unknown columns the way PostgreSQL does (the same
 *     fake as auth.sessionRevocation.a48.test.js, plus INSERT);
 *   - Redis, as an in-memory map behind redis.service's helper API;
 *   - the user rows (Users.findOne / findByPk / create are spied), the user
 *     loader getAuthUserWithTenant, password hashing (bcrypt cost is not under
 *     test), the email queue, and the IdP (ssoService / tenant settings);
 *   - authService.loginMfa at the MFA route: the route's job under test is
 *     which token it accepts, not the TOTP check.
 *
 * What it does not prove: that PostgreSQL executes these statements, or that a
 * browser follows the flows. That needs a running server.
 */

import type { Request, Response } from "express";
import type * as ModelsModule from "../../models";
import type * as ConfigModule from "../../config";
import type * as AuthMiddlewareModule from "../../middlewares/auth.middleware";
import type * as AuthServiceModule from "../../services/auth.service";
import type * as AuthControllerModule from "../../controllers/auth.controller";
import type * as SsoControllerModule from "../../controllers/sso.controller";
import type * as SsoServiceModule from "../../services/sso.service";
import type * as AuditServiceModule from "../../services/audit.service";
import type * as TenantServiceModule from "../../services/tenant.service";
import type * as SessionServiceModule from "../../services/session.service";
import type * as JwtUtilModule from "../../utils/jwt.util";
import type * as SocketConfigModule from "../../config/socket";
import type * as EmailQueueServiceModule from "../../services/emailQueue.service";

interface MockRedisService {
  mockStore: Map<string, string>;
  get: jest.Mock<Promise<unknown>, [string]>;
  set: jest.Mock<Promise<boolean>, [string, unknown]>;
  del: jest.Mock<Promise<boolean>, [string]>;
  getDel: jest.Mock<Promise<unknown>, [string]>;
  acquireLock: jest.Mock<Promise<string>, []>;
  releaseLock: jest.Mock<Promise<boolean>, []>;
  cacheKeys: {
    userByEmail: (email: string) => string;
    userByUsername: (username: string) => string;
  };
}

// A-288 (ADR-100): the network policy has its own suites (signInPolicy.*.a288); here it permits.
jest.mock("../../services/signInPolicy.service", () => ({ assertSignInPermitted: jest.fn(() => Promise.resolve(undefined)) }));
jest.mock("../../services/redis.service", () => {
  const mockStore = new Map<string, string>();
  return {
    mockStore,
    get: jest.fn((key: string): Promise<unknown> => {
      const raw = mockStore.get(key);
      return Promise.resolve(raw ? JSON.parse(raw) as unknown : null);
    }),
    set: jest.fn((key: string, value: unknown): Promise<boolean> => {
      mockStore.set(key, JSON.stringify(value));
      return Promise.resolve(true);
    }),
    del: jest.fn((key: string): Promise<boolean> => {
      mockStore.delete(key);
      return Promise.resolve(true);
    }),
    // A-60: the SSO hand-off code is consumed with GETDEL.
    getDel: jest.fn((key: string): Promise<unknown> => {
      const raw = mockStore.get(key);
      if (!raw) {
        return Promise.resolve(null);
      }
      const value = JSON.parse(raw) as unknown;
      mockStore.delete(key);
      return Promise.resolve(value);
    }),
    acquireLock: jest.fn(() => Promise.resolve("lock-id")),
    releaseLock: jest.fn(() => Promise.resolve(true)),
    cacheKeys: {
      userByEmail: (email: string) => `user:email:${email}`,
      userByUsername: (username: string) => `user:username:${username}`,
    },
  };
});

jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn(),
  queueOtpEmail: jest.fn(),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
  comparePassword: jest.fn((plain: string, hash: string) => Promise.resolve(hash === `hashed:${plain}`)),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { sequelize, Sessions, Users, Tenants } = require("../../models") as typeof ModelsModule;
const { db } = require("../../config") as typeof ConfigModule;
const { auth, optionalAuth } = require("../../middlewares/auth.middleware") as typeof AuthMiddlewareModule;
const authService = require("../../services/auth.service") as typeof AuthServiceModule;
const authController = require("../../controllers/auth.controller") as typeof AuthControllerModule;
const ssoController = require("../../controllers/sso.controller") as typeof SsoControllerModule;
const ssoService = require("../../services/sso.service") as typeof SsoServiceModule;
const auditService = require("../../services/audit.service") as typeof AuditServiceModule;
const tenantService = require("../../services/tenant.service") as typeof TenantServiceModule;
const sessionService = require("../../services/session.service") as typeof SessionServiceModule;
const redis = require("../../services/redis.service") as MockRedisService;
const { queueActivationEmail } = require("../../services/emailQueue.service") as typeof EmailQueueServiceModule;
const {
  generateAccessToken,
  decodeToken,
} = require("../../utils/jwt.util") as typeof JwtUtilModule;
const { __testables: socketTestables } = require("../../config/socket") as typeof SocketConfigModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const { authenticateHandshake, AUTH_ERROR } = socketTestables;

const USER_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";
const EMAIL = "user@hospital.example.com";

const SESSION_COLUMNS = new Set([
  "id",
  "user_id",
  "tenant_id",
  "impersonator_id", // A-146, migration 0040-session-impersonator
  "auth_method", // A-160, migration 0052-session-auth-method
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
  code?: string;
}

const pgUndefinedColumn = (column: string): PgError => {
  const err: PgError = new Error(`column "${column}" does not exist`);
  err.code = "42703";
  return err;
};

const parseLiteral = (text: string): string | number | boolean => {
  const t = text.trim();
  if (t === "true") {
    return true;
  }
  if (t === "false") {
    return false;
  }
  const quoted = /^'(.*)'$/.exec(t);
  if (quoted?.[1] !== undefined) {
    return quoted[1];
  }
  return Number(t);
};

type SessionRow = Record<string, string | number | boolean | Date | null | undefined>;

interface FakeSessionsDb {
  connection: {
    query: (
      sql: string,
      params: unknown[] | ((err: Error | null, result?: unknown) => void),
      cb?: (err: Error | null, result?: unknown) => void,
    ) => void;
  };
  table: Map<string, SessionRow>;
}

/**
 * A fake pg connection over an in-memory `sessions` table: SELECT and UPDATE
 * as in the A-48 test, and the INSERT Sequelize emits for Sessions.create.
 */
const fakeSessionsDb = (): FakeSessionsDb => {
  const table = new Map<string, SessionRow>();

  const checkColumns = (identifiers: string[]): void => {
    for (const col of identifiers) {
      if (!SESSION_COLUMNS.has(col)) {
        throw pgUndefinedColumn(col);
      }
    }
  };

  const matches = (row: SessionRow, predicates: [string, string | number | boolean | null][]): boolean =>
    predicates.every(([col, value]) => {
      const cell = row[col];
      if (value === null) {
        return cell === null;
      }
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
    const itemGroup = m[1];
    const items = itemGroup.split(", ").map((item) => {
      const im = /^(?:"Session"\.)?"([^"]+)"(?: AS "([^"]+)")?$/.exec(item.trim());
      if (!im?.[1]) {
        throw new Error(`fake pg: unsupported projection item: ${item}`);
      }
      return { column: im[1], as: im[2] ?? im[1] };
    });
    const predicates: [string, string | number | boolean | null][] = m[2]
      ? m[2].split(" AND ").map((p) => {
        const pm = /^"Session"\."([^"]+)" = (.+)$/.exec(p.trim());
        if (!pm?.[1] || !pm[2]) {
          throw new Error(`fake pg: unsupported predicate: ${p}`);
        }
        return [pm[1], parseLiteral(pm[2])];
      })
      : [];
    checkColumns([...items.map((i) => i.column), ...predicates.map(([c]) => c)]);
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
    const sets = m[1].split(",").map((s) => {
      const sm = /^"([^"]+)"=(\$\d+)$/.exec(s.trim());
      if (!sm?.[1] || !sm[2]) {
        throw new Error(`fake pg: unsupported SET: ${s}`);
      }
      return [sm[1], bind(sm[2])] as [string, unknown];
    });
    const predicates = m[2].replace(/ RETURNING .*$/, "").split(" AND ").map((p) => {
      const pm = /^"([^"]+)" = (\$\d+)$/.exec(p.trim());
      if (!pm?.[1] || !pm[2]) {
        throw new Error(`fake pg: unsupported predicate: ${p}`);
      }
      return [pm[1], bind(pm[2])] as [string, string | number | boolean | null];
    });
    checkColumns([...sets.map(([c]) => c), ...predicates.map(([c]) => c)]);
    let count = 0;
    for (const row of table.values()) {
      if (matches(row, predicates)) {
        for (const [c, v] of sets) {
          row[c] = v as SessionRow[string];
        }
        count += 1;
      }
    }
    return { rows: [], rowCount: count };
  };

  const insert = (sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } => {
    const m = /^INSERT INTO "sessions" \((.+?)\) VALUES \((.+?)\)(?: RETURNING .*)?;$/.exec(sql);
    if (!m?.[1] || !m[2]) {
      throw new Error(`fake pg: unsupported INSERT: ${sql}`);
    }
    const columns = m[1].split(",").map((c) => {
      const cm = /^"([^"]+)"$/.exec(c.trim());
      if (!cm?.[1]) {
        throw new Error(`fake pg: unsupported column: ${c}`);
      }
      return cm[1];
    });
    checkColumns(columns);
    const values = m[2].split(",").map((v) => params[Number(v.trim().slice(1)) - 1]);
    const row: SessionRow = {
      is_revoked: false,
      is_active: true,
      is_deleted: false,
      ...Object.fromEntries(columns.map((c, i) => [c, values[i]])),
    };
    table.set(String(row["id"]), row);
    return { rows: [row], rowCount: 1 };
  };

  const connection = {
    query(
      sql: string,
      params: unknown[] | ((err: Error | null, result?: unknown) => void),
      cb?: (err: Error | null, result?: unknown) => void,
    ) {
      const callback = (typeof params === "function" ? params : cb) as (err: Error | null, result?: unknown) => void;
      const values = typeof params === "function" ? [] : params;
      try {
        if (sql.startsWith("SELECT")) {
          callback(null, select(sql));
          return;
        }
        if (sql.startsWith("UPDATE")) {
          callback(null, update(sql, values));
          return;
        }
        if (sql.startsWith("INSERT")) {
          callback(null, insert(sql, values));
          return;
        }
        callback(null, { rows: [], rowCount: 0 });
      } catch (err) {
        callback(err as Error);
      }
    },
  };

  return { connection, table };
};

let fakeDb: FakeSessionsDb;
interface PrincipalUser {
  id: string;
  tenantId: string;
  isActive: boolean;
  status: string;
  role: { name: string };
  tenant: { id: string; name: string; status: string };
}
let principal: PrincipalUser;

interface MockExpressResponse {
  status: jest.Mock;
  json: jest.Mock;
  cookie: jest.Mock;
  clearCookie: jest.Mock;
  redirect: jest.Mock;
}

const mockRes = (): MockExpressResponse => {
  const res: MockExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  };
  return res;
};

/**
 * Present `token` as a bearer to the real `auth` middleware.
 * @returns {Promise<{status: number|"next", message?: string, req: object}>}
 */
const asBearer = (token: string): Promise<{ status: number | "next"; message?: string | undefined; req: Request }> =>
  new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      params: {},
      body: {},
      query: {},
    } as unknown as Request;
    const res = mockRes();
    const handleAuth = auth(req, res as unknown as Response, () => {
      resolve({ status: "next", req });
    });
    void Promise.resolve(handleAuth).then(() => {
      if (res.status.mock.calls.length > 0) {
        const statusCalls = res.status.mock.calls as [number][];
        const jsonCalls = res.json.mock.calls as [{ message?: string }][];
        resolve({
          status: statusCalls[0]?.[0] ?? 500,
          message: jsonCalls[0]?.[0]?.message,
          req,
        });
      }
    });
  });

/** Present `token` to `optionalAuth`; resolves with the principal it set. */
const asOptionalBearer = (token: string): Promise<unknown> =>
  new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      params: {},
      body: {},
      query: {},
    } as unknown as Request & { user?: unknown };
    optionalAuth(req, mockRes() as unknown as Response, () => {
      resolve(req.user ?? null);
    });
  });

/** GET /auth/activation?token=… through the real controller and service. */
const activate = async (token: string): Promise<{ status: number; message: string }> => {
  const res = mockRes();
  await authController.activation(
    { query: { token }, headers: {} } as unknown as Request,
    res as unknown as Response,
    jest.fn(),
  );
  const statusCalls = res.status.mock.calls as [number][];
  const jsonCalls = res.json.mock.calls as [{ message: string }][];
  return {
    status: statusCalls[0]?.[0] ?? 500,
    message: jsonCalls[0]?.[0]?.message ?? "",
  };
};

/** POST /auth/mfa/login through the real controller. */
const completeMfa = async (token: string): Promise<{ status: number; message: string }> => {
  const res = mockRes();
  await authController.loginMfa(
    { body: { code: "123456", token }, headers: {}, ip: "10.0.0.1" } as unknown as Request,
    res as unknown as Response,
    jest.fn(),
  );
  const statusCalls = res.status.mock.calls as [number][];
  const jsonCalls = res.json.mock.calls as [{ message: string }][];
  return {
    status: statusCalls[0]?.[0] ?? 500,
    message: jsonCalls[0]?.[0]?.message ?? "",
  };
};

/** The socket handshake; resolves true when the connection is accepted. */
const opensSocket = async (token: string): Promise<boolean> => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const next = jest.fn();
  await authenticateHandshake({ handshake: { auth: { token } } } as unknown as Parameters<typeof authenticateHandshake>[0], next);
  const nextCalls = next.mock.calls as [Error | undefined][];
  const err = nextCalls[0]?.[0];
  if (err) {
    expect(err.message).toBe(AUTH_ERROR);
    return false;
  }
  return true;
};

/** Mint an activation token the way registration does, and return it. */
const registerAndCaptureActivationToken = async (): Promise<string> => {
  jest.spyOn(db, "transaction").mockImplementation((() => Promise.resolve({
    LOCK: { UPDATE: "UPDATE" },
    finished: undefined,
    commit: jest.fn(() => Promise.resolve(undefined)),
    rollback: jest.fn(() => Promise.resolve(undefined)),
  })) as unknown as typeof db.transaction);
  jest.spyOn(Users, "findOne").mockResolvedValue(null);
  jest.spyOn(Users, "create").mockResolvedValue({ id: USER_ID });
  // P6-11: registration writes its audit row in this (fake) transaction; the
  // row is proved by auth.activationBinding.a191, not here.
  jest.spyOn(auditService, "logAction").mockResolvedValueOnce({});

  await authService.registerUser(
    {
      firstName: "Ada",
      lastName: "Lovelace",
      username: "adalovelace",
      email: EMAIL,
      password: "Str0ng!Passw0rd",
    },
    "https://app.test",
  );

  const queueActivationEmailMock = queueActivationEmail as unknown as jest.Mock;
  const calls = queueActivationEmailMock.mock.calls as [{ activationLink: string }][];
  const activationLink = calls[0]?.[0]?.activationLink ?? "";
  const token = new URL(activationLink).searchParams.get("token");
  return token ?? "";
};

/** Pass the first factor of an MFA-enabled account; return the pending token. */
const firstFactorOfMfaAccount = async (): Promise<string> => {
  jest.spyOn(Users, "findOne").mockResolvedValue({
    id: USER_ID,
    username: "adalovelace",
    email: EMAIL,
    password: "hashed:Str0ng!Passw0rd",
    isActive: true,
    tenantId: TENANT_ID,
    tenant: { id: TENANT_ID, status: "active" }, // A-83
    failedLoginAttempts: 0,
    lockedUntil: null,
    mfaEnabled: true,
    role: null,
    update: jest.fn(() => Promise.resolve(undefined)),
  } as unknown as InstanceType<typeof Users>);
  const result = await authService.loginUser({
    user: "adalovelace",
    password: "Str0ng!Passw0rd",
  }) as { status: number; token: string };
  expect(result.status).toBe(202);
  return result.token;
};

/**
 * Run an SSO callback against a stubbed IdP, then redeem its one-time code the
 * way the frontend server does (A-60); return the access token.
 */
const ssoLogin = async (kind: "saml" | "oidc"): Promise<string> => {
  jest.spyOn(Tenants, "findOne").mockResolvedValue({ id: TENANT_ID, code: "rs" } as unknown as InstanceType<typeof Tenants>);
  jest
    .spyOn(tenantService, "getTenantSettings")
    .mockResolvedValue({ data: { settings: { sso_enabled: "true" } } } as unknown as Awaited<ReturnType<typeof tenantService.getTenantSettings>>);
  jest
    .spyOn(ssoService, "parseAndVerifyResponse")
    .mockResolvedValue({ email: EMAIL } as unknown as Awaited<ReturnType<typeof ssoService.parseAndVerifyResponse>>);
  jest
    .spyOn(ssoService, "verifyOidcCallback")
    .mockResolvedValue({ email: EMAIL } as unknown as Awaited<ReturnType<typeof ssoService.verifyOidcCallback>>);
  jest
    .spyOn(ssoService, "provisionUser")
    .mockResolvedValue({ id: USER_ID, email: EMAIL } as unknown as Awaited<ReturnType<typeof ssoService.provisionUser>>);

  const res = mockRes();
  const req: {
    params: { tenantCode: string };
    body: { SAMLResponse?: string; code?: string; state?: string };
    headers: Record<string, string>;
    ip: string;
  } =
    kind === "saml"
      ? { params: { tenantCode: "rs" }, body: { SAMLResponse: "x" }, headers: {}, ip: "10.0.0.1" }
      : { params: { tenantCode: "rs" }, body: { code: "c" }, headers: {}, ip: "10.0.0.1" };
  if (kind !== "saml") {
    // A-68: an OIDC callback needs a sign-in this server started.
    const flow = await ssoController.beginOidcFlow("rs", "https://sp.example.com/cb");
    req.body.state = flow.state;
    req.headers["cookie"] = `${ssoController.OIDC_BINDING_COOKIE}=${flow.binding}`;
  }
  const handler = kind === "saml" ? ssoController.ssoCallback : ssoController.oidcCallback;
  await handler(req as unknown as Request, res as unknown as Response, jest.fn());

  expect(res.redirect).toHaveBeenCalledTimes(1);
  const redirectCalls = res.redirect.mock.calls as [string][];
  const redirectUrl = redirectCalls[0]?.[0] ?? "";
  const code = new URL(redirectUrl).searchParams.get("code");

  // The LOGIN audit row is not under test here, and the fake pg wire knows
  // only the sessions table.
  jest.spyOn(auditService, "logAction").mockResolvedValue({ id: "audit" });
  // A-188: the exchange stamps users.last_login_at — the users table is not
  // on this fake wire either.
  jest.spyOn(Users, "update").mockResolvedValue([1]);
  // A-83: the exchange re-reads the user and its tenant before the session.
  jest.spyOn(Users, "findByPk").mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    isActive: true,
    status: "ACTIVE",
    tenant: { id: TENANT_ID, status: "active" },
  } as unknown as InstanceType<typeof Users>);
  const exRes = mockRes();
  await ssoController.ssoExchange(
    { body: { code }, headers: {}, rateLimitContext: {} } as unknown as Request,
    exRes as unknown as Response,
    jest.fn(),
  );
  expect(exRes.status).toHaveBeenCalledWith(200);
  const jsonCalls = exRes.json.mock.calls as [{ token: string }][];
  return jsonCalls[0]?.[0]?.token ?? "";
};

beforeEach(() => {
  redis.mockStore.clear();
  fakeDb = fakeSessionsDb();
  jest
    .spyOn(sequelize.connectionManager, "getConnection")
    .mockResolvedValue(fakeDb.connection);
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
    .mockImplementation(() => Promise.resolve(principal as never));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-59: the activation token is not an access token", () => {
  it("an activation token presented as a bearer is rejected", async () => {
    const token = await registerAndCaptureActivationToken();
    expect((decodeToken(token) as { typ?: string } | null)?.typ).toBe("activation");

    const res = await asBearer(token);
    expect(res.status).toBe(401);
    expect(await asOptionalBearer(token)).toBeNull();
    expect(await opensSocket(token)).toBe(false);
  });

  it("the activation route accepts the activation token", async () => {
    const token = await registerAndCaptureActivationToken();
    const user = {
      id: USER_ID,
      email: EMAIL,
      username: "adalovelace",
      isEmailVerified: false,
      update: jest.fn(() => Promise.resolve(undefined)),
    };
    jest.spyOn(Users, "findByPk").mockResolvedValue(user as never);
    // A-191: activation is a managed transaction (the update and its audit).
    jest.spyOn(db, "transaction").mockImplementation(((fn: (tx: { id: string }) => Promise<unknown>) => fn({ id: "tx" })) as unknown as typeof db.transaction);

    expect(await activate(token)).toEqual({
      status: 200,
      message: "Account activated successfully",
    });
    // A-191: in a transaction, with its audit row.
    expect(user.update).toHaveBeenCalledWith({ isEmailVerified: true }, expect.anything());
  });

  it("the activation route refuses an access token with 400, and activates nothing", async () => {
    const findByPk = jest.spyOn(Users, "findByPk");

    expect(await activate(generateAccessToken({ id: USER_ID, sid: "s" }))).toEqual({
      status: 400,
      message: "Invalid or expired activation token",
    });
    expect(findByPk).not.toHaveBeenCalled();
  });
});

describe("A-59: the MFA-pending token", () => {
  it("an MFA-pending token is accepted only by MFA completion", async () => {
    const token = await firstFactorOfMfaAccount();
    expect((decodeToken(token) as { typ?: string } | null)?.typ).toBe("mfa");
    const findByPk = jest.spyOn(Users, "findByPk");

    // Refused as a bearer, by optionalAuth, at the socket and at activation.
    expect((await asBearer(token)).status).toBe(401);
    expect(await asOptionalBearer(token)).toBeNull();
    expect(await opensSocket(token)).toBe(false);
    expect((await activate(token)).status).toBe(400);
    expect(findByPk).not.toHaveBeenCalled();

    // Accepted by the MFA completion route, for the user who passed factor one.
    const loginMfa = jest.spyOn(authService, "loginMfa").mockResolvedValue({
      data: { id: USER_ID },
      token: "final-access-token",
      session: { id: "s" },
    });
    expect((await completeMfa(token)).status).toBe(200);
    expect(loginMfa).toHaveBeenCalledWith(USER_ID, "123456", "10.0.0.1", undefined, {
      recoveryCode: undefined,
    });
  });

  it("MFA completion refuses an access token, even one carrying mfaRequired", async () => {
    const loginMfa = jest.spyOn(authService, "loginMfa");

    const forged = generateAccessToken({ id: USER_ID, mfaRequired: true });
    expect(await completeMfa(forged)).toEqual({
      status: 401,
      message: "Invalid or expired login token",
    });
    expect(loginMfa).not.toHaveBeenCalled();
  });

  it("the first factor creates no session: the session is created when the second factor passes", async () => {
    await firstFactorOfMfaAccount();
    expect(fakeDb.table.size).toBe(0);
  });
});

describe("A-59 / A-52: the socket token", () => {
  const issueSocketToken = async (sessionId: string | undefined): Promise<string> => {
    const res = mockRes();
    await authController.socketToken(
      { user: { id: USER_ID }, sessionId, headers: {} } as unknown as Request,
      res as unknown as Response,
      jest.fn(),
    );
    const jsonCalls = res.json.mock.calls as [{ data: { token: string } }][];
    return jsonCalls[0]?.[0]?.data.token ?? "";
  };

  it("a socket token presented as a bearer is rejected", async () => {
    const token = await issueSocketToken(undefined);
    expect((decodeToken(token) as { typ?: string } | null)?.typ).toBe("socket");

    expect((await asBearer(token)).status).toBe(401);
    expect(await asOptionalBearer(token)).toBeNull();
  });

  it("the handshake accepts a socket token, refuses an access token, and refuses a socket token whose session was revoked", async () => {
    const accessToken = await ssoLogin("oidc");
    const { sid } = decodeToken(accessToken) as { sid: string };
    const socketToken = await issueSocketToken(sid);

    expect(await opensSocket(socketToken)).toBe(true);
    expect(await opensSocket(accessToken)).toBe(false);

    await sessionService.revokeSessionById(sid, "LOGOUT");
    expect(await opensSocket(socketToken)).toBe(false);
  });
});

describe("A-59: SSO tokens are revocable", () => {
  it.each(["saml", "oidc"] as const)(
    "an SSO-issued token is revoked when its session is revoked (%s)",
    async (kind) => {
      const token = await ssoLogin(kind);

      // The token names the session the callback created.
      const { sid } = decodeToken(token) as { sid: string };
      expect(fakeDb.table.get(sid)).toMatchObject({
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        is_revoked: false,
      });
      expect((await asBearer(token)).status).toBe("next");

      // The administrator's / password-change path: revoke all of the user's
      // sessions. Before A-59 the token named no session and kept working.
      await sessionService.revokeAllSessions(USER_ID as never, "PASSWORD_CHANGED");

      const after = await asBearer(token);
      expect(after.status).toBe(401);
      expect(after.message).toBe("Session has been revoked or has expired");
    },
  );

  it("logging out of an SSO session stops its token", async () => {
    const token = await ssoLogin("oidc");
    const other = await ssoLogin("saml");

    await new Promise<void>((resolve) => {
      const req = { headers: { authorization: `Bearer ${token}` }, params: {}, body: {}, query: {} };
      void auth(req as unknown as Request, mockRes() as unknown as Response, () => {
        void authService.logoutSession().then(() => {
          resolve();
        });
      });
    });

    expect((await asBearer(token)).status).toBe(401);
    expect((await asBearer(other)).status).toBe("next");
  });
});

describe("A-59 / P6-12: sid-less access tokens (issued before the deploy)", () => {
  it("P6-12: an access token without sid is refused — it names no session, so it could never be revoked", async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { SIDLESS_ACCESS_TOKENS_ACCEPTED } = require("../../middlewares/auth.middleware") as {
      SIDLESS_ACCESS_TOKENS_ACCEPTED: boolean;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    expect(SIDLESS_ACCESS_TOKENS_ACCEPTED).toBe(false);

    const legacy = generateAccessToken({ id: USER_ID, email: EMAIL });
    expect((await asBearer(legacy)).status).toBe(401);
  });
});

describe("A-59: the Sessions table the tokens are bound to", () => {
  it("is the real model (a camelCase column fails the way PostgreSQL does)", async () => {
    await expect(
      Sessions.findOne({ where: { isRevoked: false }, skipTenantScope: true } as unknown as Parameters<typeof Sessions.findOne>[0]),
    ).rejects.toThrow('column "isRevoked" does not exist');
  });
});
