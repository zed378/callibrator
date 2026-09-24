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

jest.mock("../../services/redis.service", () => {
  const mockStore = new Map();
  return {
    mockStore,
    get: jest.fn(async (key) =>
      mockStore.has(key) ? JSON.parse(mockStore.get(key)) : null,
    ),
    set: jest.fn(async (key, value) => {
      mockStore.set(key, JSON.stringify(value));
      return true;
    }),
    del: jest.fn(async (key) => {
      mockStore.delete(key);
      return true;
    }),
    // A-60: the SSO hand-off code is consumed with GETDEL.
    getDel: jest.fn(async (key) => {
      if (!mockStore.has(key)) {
        return null;
      }
      const value = JSON.parse(mockStore.get(key));
      mockStore.delete(key);
      return value;
    }),
    acquireLock: jest.fn(async () => "lock-id"),
    releaseLock: jest.fn(async () => true),
    cacheKeys: {
      userByEmail: (email) => `user:email:${email}`,
      userByUsername: (username) => `user:username:${username}`,
    },
  };
});

jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn(),
  queueOtpEmail: jest.fn(),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(async (plain) => `hashed:${plain}`),
  comparePassword: jest.fn(async (plain, hash) => hash === `hashed:${plain}`),
}));

const { sequelize, Sessions, Users, Tenants } = require("../../models");
const { db } = require("../../config");
const { auth, optionalAuth } = require("../../middlewares/auth.middleware");
const authService = require("../../services/auth.service");
const authController = require("../../controllers/auth.controller");
const ssoController = require("../../controllers/sso.controller");
const ssoService = require("../../services/sso.service");
const auditService = require("../../services/audit.service");
const tenantService = require("../../services/tenant.service");
const sessionService = require("../../services/session.service");
const redis = require("../../services/redis.service");
const { queueActivationEmail } = require("../../services/emailQueue.service");
const {
  generateAccessToken,
  decodeToken,
} = require("../../utils/jwt.util");
const { __testables: socketTestables } = require("../../config/socket");

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
 * A fake pg connection over an in-memory `sessions` table: SELECT and UPDATE
 * as in the A-48 test, and the INSERT Sequelize emits for Sessions.create.
 */
const fakeSessionsDb = () => {
  const table = new Map();

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
    const items = m[1].split(", ").map((item) => {
      const im = /^(?:"Session"\.)?"([^"]+)"(?: AS "([^"]+)")?$/.exec(item.trim());
      if (!im) {
        throw new Error(`fake pg: unsupported projection item: ${item}`);
      }
      return { column: im[1], as: im[2] || im[1] };
    });
    const predicates = m[2]
      ? m[2].split(" AND ").map((p) => {
        const pm = /^"Session"\."([^"]+)" = (.+)$/.exec(p.trim());
        if (!pm) {
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

  const insert = (sql, params) => {
    const m = /^INSERT INTO "sessions" \((.+?)\) VALUES \((.+?)\)(?: RETURNING .*)?;$/.exec(sql);
    if (!m) {
      throw new Error(`fake pg: unsupported INSERT: ${sql}`);
    }
    const columns = m[1].split(",").map((c) => /^"([^"]+)"$/.exec(c.trim())[1]);
    checkColumns(columns);
    const values = m[2].split(",").map((v) => params[Number(v.trim().slice(1)) - 1]);
    const row = {
      is_revoked: false,
      is_active: true,
      is_deleted: false,
      ...Object.fromEntries(columns.map((c, i) => [c, values[i]])),
    };
    table.set(row.id, row);
    return { rows: [row], rowCount: 1 };
  };

  const connection = {
    query(sql, params, cb) {
      const callback = typeof params === "function" ? params : cb;
      const values = typeof params === "function" ? [] : params;
      try {
        if (sql.startsWith("SELECT")) {
          return callback(null, select(sql));
        }
        if (sql.startsWith("UPDATE")) {
          return callback(null, update(sql, values));
        }
        if (sql.startsWith("INSERT")) {
          return callback(null, insert(sql, values));
        }
        return callback(null, { rows: [], rowCount: 0 });
      } catch (err) {
        return callback(err);
      }
    },
  };

  return { connection, table };
};

let fakeDb;
let principal;

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  cookie: jest.fn().mockReturnThis(),
  clearCookie: jest.fn().mockReturnThis(),
  redirect: jest.fn(),
});

/**
 * Present `token` as a bearer to the real `auth` middleware.
 * @returns {Promise<{status: number|"next", message?: string, req: object}>}
 */
const asBearer = (token) =>
  new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      params: {},
      body: {},
      query: {},
    };
    const res = mockRes();
    auth(req, res, () => resolve({ status: "next", req })).then(() => {
      if (res.status.mock.calls.length) {
        resolve({
          status: res.status.mock.calls[0][0],
          message: res.json.mock.calls[0][0].message,
          req,
        });
      }
    });
  });

/** Present `token` to `optionalAuth`; resolves with the principal it set. */
const asOptionalBearer = (token) =>
  new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      params: {},
      body: {},
      query: {},
    };
    optionalAuth(req, mockRes(), () => resolve(req.user || null));
  });

/** GET /auth/activation?token=… through the real controller and service. */
const activate = async (token) => {
  const res = mockRes();
  await authController.activation({ query: { token }, headers: {} }, res);
  return {
    status: res.status.mock.calls[0][0],
    message: res.json.mock.calls[0][0].message,
  };
};

/** POST /auth/mfa/login through the real controller. */
const completeMfa = async (token) => {
  const res = mockRes();
  await authController.loginMfa(
    { body: { code: "123456", token }, headers: {}, ip: "10.0.0.1" },
    res,
  );
  return {
    status: res.status.mock.calls[0][0],
    message: res.json.mock.calls[0][0].message,
  };
};

/** The socket handshake; resolves true when the connection is accepted. */
const opensSocket = async (token) => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const next = jest.fn();
  await authenticateHandshake({ handshake: { auth: { token } } }, next);
  const [err] = next.mock.calls[0];
  if (err) {
    expect(err.message).toBe(AUTH_ERROR);
    return false;
  }
  return true;
};

/** Mint an activation token the way registration does, and return it. */
const registerAndCaptureActivationToken = async () => {
  jest.spyOn(db, "transaction").mockResolvedValue({
    LOCK: { UPDATE: "UPDATE" },
    finished: undefined,
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  });
  jest.spyOn(Users, "findOne").mockResolvedValue(null);
  jest.spyOn(Users, "create").mockResolvedValue({ id: USER_ID });

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

  const [{ activationLink }] = queueActivationEmail.mock.calls[0];
  return new URL(activationLink).searchParams.get("token");
};

/** Pass the first factor of an MFA-enabled account; return the pending token. */
const firstFactorOfMfaAccount = async () => {
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
    update: jest.fn(async () => undefined),
  });
  const result = await authService.loginUser({
    user: "adalovelace",
    password: "Str0ng!Passw0rd",
  });
  expect(result.status).toBe(202);
  return result.token;
};

/**
 * Run an SSO callback against a stubbed IdP, then redeem its one-time code the
 * way the frontend server does (A-60); return the access token.
 */
const ssoLogin = async (kind) => {
  jest.spyOn(Tenants, "findOne").mockResolvedValue({ id: TENANT_ID, code: "rs" });
  jest
    .spyOn(tenantService, "getTenantSettings")
    .mockResolvedValue({ data: { settings: { sso_enabled: "true" } } });
  jest
    .spyOn(ssoService, "parseAndVerifyResponse")
    .mockResolvedValue({ email: EMAIL });
  jest
    .spyOn(ssoService, "verifyOidcCallback")
    .mockResolvedValue({ email: EMAIL });
  jest
    .spyOn(ssoService, "provisionUser")
    .mockResolvedValue({ id: USER_ID, email: EMAIL });

  const res = mockRes();
  const req =
    kind === "saml"
      ? { params: { tenantCode: "rs" }, body: { SAMLResponse: "x" }, headers: {}, ip: "10.0.0.1" }
      : { params: { tenantCode: "rs" }, body: { code: "c" }, headers: {}, ip: "10.0.0.1" };
  if (kind !== "saml") {
    // A-68: an OIDC callback needs a sign-in this server started.
    const flow = await ssoController.beginOidcFlow("rs", "https://sp.example.com/cb");
    req.body.state = flow.state;
    req.headers.cookie = `${ssoController.OIDC_BINDING_COOKIE}=${flow.binding}`;
  }
  const handler = kind === "saml" ? ssoController.ssoCallback : ssoController.oidcCallback;
  await handler(req, res, jest.fn());

  expect(res.redirect).toHaveBeenCalledTimes(1);
  const code = new URL(res.redirect.mock.calls[0][0]).searchParams.get("code");

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
  });
  const exRes = mockRes();
  await ssoController.ssoExchange(
    { body: { code }, headers: {}, rateLimitContext: {} },
    exRes,
    jest.fn(),
  );
  expect(exRes.status).toHaveBeenCalledWith(200);
  return exRes.json.mock.calls[0][0].token;
};

beforeEach(() => {
  // __mocks__/uuid.js answers one constant id (uuid@14 is ESM-only); two
  // sessions must have two ids here.
  require("uuid").v4.mockImplementation(() => require("crypto").randomUUID());
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
    .mockImplementation(async () => principal);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-59: the activation token is not an access token", () => {
  it("an activation token presented as a bearer is rejected", async () => {
    const token = await registerAndCaptureActivationToken();
    expect(decodeToken(token).typ).toBe("activation");

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
      update: jest.fn(async () => undefined),
    };
    jest.spyOn(Users, "findByPk").mockResolvedValue(user);
    // A-191: activation is a managed transaction (the update and its audit).
    db.transaction.mockImplementation(async (fn) => fn({ id: "tx" }));

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
    expect(decodeToken(token).typ).toBe("mfa");
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
  const issueSocketToken = async (sessionId) => {
    const res = mockRes();
    await authController.socketToken(
      { user: { id: USER_ID }, sessionId, headers: {} },
      res,
    );
    return res.json.mock.calls[0][0].data.token;
  };

  it("a socket token presented as a bearer is rejected", async () => {
    const token = await issueSocketToken(undefined);
    expect(decodeToken(token).typ).toBe("socket");

    expect((await asBearer(token)).status).toBe(401);
    expect(await asOptionalBearer(token)).toBeNull();
  });

  it("the handshake accepts a socket token, refuses an access token, and refuses a socket token whose session was revoked", async () => {
    const accessToken = await ssoLogin("oidc");
    const { sid } = decodeToken(accessToken);
    const socketToken = await issueSocketToken(sid);

    expect(await opensSocket(socketToken)).toBe(true);
    expect(await opensSocket(accessToken)).toBe(false);

    await sessionService.revokeSessionById(sid, "LOGOUT");
    expect(await opensSocket(socketToken)).toBe(false);
  });
});

describe("A-59: SSO tokens are revocable", () => {
  it.each(["saml", "oidc"])(
    "an SSO-issued token is revoked when its session is revoked (%s)",
    async (kind) => {
      const token = await ssoLogin(kind);

      // The token names the session the callback created.
      const { sid } = decodeToken(token);
      expect(fakeDb.table.get(sid)).toMatchObject({
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        is_revoked: false,
      });
      expect((await asBearer(token)).status).toBe("next");

      // The administrator's / password-change path: revoke all of the user's
      // sessions. Before A-59 the token named no session and kept working.
      await sessionService.revokeAllSessions(USER_ID, "PASSWORD_CHANGED");

      const after = await asBearer(token);
      expect(after.status).toBe(401);
      expect(after.message).toBe("Session has been revoked or has expired");
    },
  );

  it("logging out of an SSO session stops its token", async () => {
    const token = await ssoLogin("oidc");
    const other = await ssoLogin("saml");

    await new Promise((resolve) => {
      const req = { headers: { authorization: `Bearer ${token}` }, params: {}, body: {}, query: {} };
      auth(req, mockRes(), async () => {
        await authService.logoutSession();
        resolve();
      });
    });

    expect((await asBearer(token)).status).toBe(401);
    expect((await asBearer(other)).status).toBe("next");
  });
});

describe("A-59: sid-less access tokens (issued before the deploy)", () => {
  it("are still accepted — SIDLESS_ACCESS_TOKENS_ACCEPTED is the switch that ends that", async () => {
    const { SIDLESS_ACCESS_TOKENS_ACCEPTED } = require("../../middlewares/auth.middleware");
    expect(SIDLESS_ACCESS_TOKENS_ACCEPTED).toBe(true);

    const legacy = generateAccessToken({ id: USER_ID, email: EMAIL });
    expect((await asBearer(legacy)).status).toBe("next");
  });
});

describe("A-59: the Sessions table the tokens are bound to", () => {
  it("is the real model (a camelCase column fails the way PostgreSQL does)", async () => {
    await expect(
      Sessions.findOne({ where: { isRevoked: false }, skipTenantScope: true }),
    ).rejects.toThrow('column "isRevoked" does not exist');
  });
});
