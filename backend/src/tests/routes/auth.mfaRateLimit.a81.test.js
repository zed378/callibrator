/**
 * A-81 — POST /auth/mfa/login is rate-limited, and wrong codes are counted.
 *
 * The route mounted no limiter. A 6-digit TOTP has 10^6 values, the MFA token
 * lives five minutes, and a fresh token costs only the password — so a stolen
 * password and an unthrottled endpoint defeated the second factor.
 *
 * These cases drive the REAL auth router through Express's `router.handle`
 * (as auth.rateLimit.a67.test.js does). What is real: the router,
 * mfaLoginPreCheck and the limiter (rateLimiter.redis.service on its
 * in-process fallback — no Redis client is ready in a unit run), the auth
 * controller and its outcome recording, auth.service.loginMfa and the MFA
 * purpose token (jwt.util), and the TOTP check — the real otplib (A-99: it
 * used to be a mock, behind which MFA login threw a TypeError in production).
 * goodCode() is the code the secret yields NOW, so "even the right code is
 * refused" is a claim about a code the service would otherwise accept. What is
 * faked: the user row (`Users.findByPk` is spied) and the lock write
 * (`Users.update` is spied); there is no database.
 *
 * What it does not prove: the per-IP key against real client addresses —
 * `req.ip` is set directly here (A-16 is the deployment half).
 */

jest.mock("../../middlewares/activityLog.middleware", () => ({
  ...jest.requireActual("../../middlewares/activityLog.middleware"),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { generateSync } = require("otplib");

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
/** The code an authenticator app shows for SECRET now. */
const goodCode = () => generateSync({ secret: SECRET });

const authRouter = require("../../routes/api/auth.route");
const { Users } = require("../../models");
const { clearMemoryStore } = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");
const { generatePurposeToken } = require("../../utils/jwt.util");

const drive = (body, ip) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      setHeader() {
        return this;
      },
      set() {
        return this;
      },
    };
    const req = {
      method: "POST",
      url: "/mfa/login",
      originalUrl: "/api/v1/auth/mfa/login",
      body,
      query: {},
      params: {},
      headers: {},
      ip,
      socket: {},
      get: () => undefined,
    };
    authRouter.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const userId = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

/** A fresh MFA token for `id` — `nonce` makes each one distinct. */
let nonce = 0;
const mfaToken = (id) => {
  nonce += 1;
  return generatePurposeToken(
    { id, email: `${id}@hospital.example.com`, mfaRequired: true, nonce },
    "mfa",
  );
};

/** A six-digit code the TOTP check refuses: none of the three the ±1 window accepts. */
const wrongCode = () => {
  const now = Math.floor(Date.now() / 1000);
  const accepted = new Set([-30, 0, 30].map((d) => generateSync({ secret: SECRET, epoch: now + d })));
  let n = 0;
  while (accepted.has(String(n).padStart(6, "0"))) {
    n += 1;
  }
  return String(n).padStart(6, "0");
};

const mfaUser = (id) => ({
  id,
  email: `${id}@hospital.example.com`,
  tenantId: null,
  isActive: true,
  status: "ACTIVE",
  lockedUntil: null,
  mfaEnabled: true,
  mfaSecret: SECRET,
  role: null,
  update: jest.fn().mockResolvedValue({}),
});

const ORIGINAL_BY_IP = process.env.AUTH_RATE_LIMIT_BY_IP;

beforeEach(() => {
  delete process.env.AUTH_RATE_LIMIT_BY_IP;
  clearMemoryStore();
  jest.restoreAllMocks();
  jest.spyOn(Users, "findByPk").mockImplementation(async (id) => mfaUser(id));
  jest.spyOn(Users, "update").mockResolvedValue([1]);
});

afterAll(() => {
  if (ORIGINAL_BY_IP === undefined) {
    delete process.env.AUTH_RATE_LIMIT_BY_IP;
  } else {
    process.env.AUTH_RATE_LIMIT_BY_IP = ORIGINAL_BY_IP;
  }
  jest.restoreAllMocks();
});

describe("A-81: wrong TOTP codes are counted and lock", () => {
  it("N wrong TOTP codes lock further attempts", async () => {
    const user = userId(1);
    const n = getAuthConfig("mfaLogin").maxAttempts;

    // Each attempt uses a FRESH MFA token — what an attacker holding the
    // password can mint at will. The lock is on the user, not the token.
    for (let i = 0; i < n; i += 1) {
      const res = await drive({ token: mfaToken(user), code: wrongCode() }, "198.51.100.40");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid MFA code");
    }

    // Locked: even the RIGHT code, on yet another fresh token, is refused
    // before the handler looks at it.
    const locked = await drive(
      { token: mfaToken(user), code: goodCode() },
      "198.51.100.41",
    );
    expect(locked.status).toBe(429);
    expect(locked.body.message).toBe("Account temporarily locked");
    expect(locked.body.retryAfter).toBeGreaterThan(0);
    // The handler loaded the user n times — never for the refused attempt.
    // (A-126: engaging the lock loads the account once more, with
    // skipTenantScope, for its ACCOUNT_LOCKED row.)
    const handlerLoads = Users.findByPk.mock.calls.filter(([, options]) => !options?.skipTenantScope);
    expect(handlerLoads).toHaveLength(n);

    // The lock is persisted to users.locked_until, which loginUser and (A-83)
    // loginMfa both honour.
    expect(Users.update).toHaveBeenCalledWith(
      expect.objectContaining({ failedLoginAttempts: n, lockedUntil: expect.any(Date) }),
      { where: { id: user } },
    );

    // Another user is answered on the merits.
    const other = await drive({ token: mfaToken(userId(2)), code: wrongCode() }, "198.51.100.41");
    expect(other.status).toBe(401);
  });

  it("three wrong codes on one MFA token revoke that token", async () => {
    const token = mfaToken(userId(3));

    for (let i = 0; i < 3; i += 1) {
      expect((await drive({ token, code: wrongCode() }, "198.51.100.42")).status).toBe(401);
    }

    const refused = await drive({ token, code: goodCode() }, "198.51.100.42");
    expect(refused.status).toBe(429);
    expect(refused.body.message).toBe("Token revoked");
  });

  it("counts an attempt with an invalid MFA token against that token", async () => {
    const forged = "not-a-jwt";

    for (let i = 0; i < 3; i += 1) {
      const res = await drive({ token: forged, code: "123456" }, "198.51.100.43");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid or expired login token");
    }
    expect((await drive({ token: forged, code: "123456" }, "198.51.100.43")).status).toBe(429);
    expect(Users.findByPk).not.toHaveBeenCalled();
  });

  it("an MFA token that names no user is counted against the token alone", async () => {
    const token = generatePurposeToken({ mfaRequired: true, nonce: "no-id" }, "mfa");

    for (let i = 0; i < 3; i += 1) {
      const res = await drive({ token, code: goodCode() }, "198.51.100.45");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid token payload");
    }
    expect((await drive({ token, code: goodCode() }, "198.51.100.45")).status).toBe(429);
    expect(Users.findByPk).not.toHaveBeenCalled();
  });

  it("a request with no token is refused on the merits and counts nothing it could be keyed on", async () => {
    const res = await drive({ code: "123456" }, "198.51.100.44");
    expect(res.status).toBe(400);
  });

  it("with AUTH_RATE_LIMIT_BY_IP=true, wrong codes spread across accounts lock the address", async () => {
    process.env.AUTH_RATE_LIMIT_BY_IP = "true";
    const ip = "198.51.100.50";
    const ipLimit = getAuthConfig("mfaLogin").maxAttempts * 3;

    // One wrong code per account: no user or token ever reaches its own limit.
    for (let i = 0; i < ipLimit; i += 1) {
      const res = await drive({ token: mfaToken(userId(100 + i)), code: wrongCode() }, ip);
      expect(res.status).toBe(401);
    }

    const blocked = await drive({ token: mfaToken(userId(999)), code: wrongCode() }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe("IP blocked");

    // Only that address.
    expect(
      (await drive({ token: mfaToken(userId(998)), code: wrongCode() }, "198.51.100.51")).status,
    ).toBe(401);
  });

  it("with AUTH_RATE_LIMIT_BY_IP unset, the address is never locked", async () => {
    const ip = "198.51.100.52";
    const ipLimit = getAuthConfig("mfaLogin").maxAttempts * 3;

    for (let i = 0; i < ipLimit + 2; i += 1) {
      const res = await drive({ token: mfaToken(userId(200 + i)), code: wrongCode() }, ip);
      expect(res.status).toBe(401);
    }
  });
});

describe("A-81: mfaLoginPreCheck faults", () => {
  it("a limiter fault is logged and passes to the handler, as authPreCheck does", async () => {
    const { mfaLoginPreCheck } = require("../../services/rateLimiter.redis.service");
    const { logger } = require("../../middlewares/activityLog.middleware");
    const req = {
      get body() {
        throw new Error("body unreadable");
      },
    };
    const next = jest.fn();

    await mfaLoginPreCheck()(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(logger.error).toHaveBeenCalledWith("MFA login pre-check error: body unreadable");
  });
});
