/**
 * A-67 — the auth rate limiter must actually record failures.
 *
 * Before this change auth.route.js mounted `authPostFailure` BEFORE each
 * handler (so it saw status 200 and recorded nothing) and `authPostSuccess`
 * AFTER a handler that never calls next() (so it never ran). The lockouts on
 * login, register, send-OTP and reset-password were therefore no-ops: any
 * number of failed attempts from one address was answered, one by one, with
 * the failure itself and never with a 429.
 *
 * These cases drive the REAL auth router through Express's own `router.handle`
 * (supertest is not a dependency of this workspace; auth.ssoExchange.a60.test.js
 * does the same). What is real: the router, authPreCheck and the limiter
 * (rateLimiter.redis.service on its in-process fallback, because no Redis
 * client is ready in a unit run), the auth controller and its error mapping,
 * auth.service and its Joi validation. What is faked: the user lookup
 * (`Users.findOne` is spied — there is no database) and nothing else.
 *
 * What it does not prove: the per-IP key behind the Next.js proxy. Without
 * `trust proxy`, `req.ip` there is the frontend server's address, so every
 * browser shares one bucket (A-16). These tests set `req.ip` directly.
 */

// Quiet, observable logger; everything else in the module is real.
jest.mock("../../middlewares/activityLog.middleware", () => ({
  ...jest.requireActual("../../middlewares/activityLog.middleware"),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const authRouter = require("../../routes/api/auth.route");
const { Users } = require("../../models");
const { clearMemoryStore } = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");

const drive = (url, body, ip) =>
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
      url,
      originalUrl: `/api/v1/auth${url}`,
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

// The per-IP lock is at maxAttempts * 3 failures (recordAuthFailure).
const ipLimit = (endpoint) => getAuthConfig(endpoint).maxAttempts * 3;

const BAD_LOGIN = { user: "nobody@hospital.example.com", password: "Wrong-password-1" };

// Per-IP counting is opt-in (AUTH_RATE_LIMIT_BY_IP) until client-IP resolution
// behind the Next proxy is fixed (A-16). This suite exercises it switched on.
const ORIGINAL_BY_IP = process.env.AUTH_RATE_LIMIT_BY_IP;

beforeEach(() => {
  process.env.AUTH_RATE_LIMIT_BY_IP = "true";
  clearMemoryStore();
  jest.restoreAllMocks();
  jest.spyOn(Users, "findOne").mockResolvedValue(null);
});

afterAll(() => {
  if (ORIGINAL_BY_IP === undefined) {
    delete process.env.AUTH_RATE_LIMIT_BY_IP;
  } else {
    process.env.AUTH_RATE_LIMIT_BY_IP = ORIGINAL_BY_IP;
  }
  jest.restoreAllMocks();
});

describe("A-67: per-IP counting is off by default", () => {
  it("with AUTH_RATE_LIMIT_BY_IP unset, failures never lock the shared proxy address", async () => {
    delete process.env.AUTH_RATE_LIMIT_BY_IP;
    const ip = "198.51.100.99";

    for (let i = 0; i < ipLimit("login") + 3; i += 1) {
      expect((await drive("/login", BAD_LOGIN, ip)).status).toBe(401);
    }
  });
});

describe("A-67: the auth rate limiter records failures through the real router", () => {
  it("N failed logins from one IP lock that IP", async () => {
    const ip = "198.51.100.10";
    const n = ipLimit("login");

    for (let i = 0; i < n; i += 1) {
      const res = await drive("/login", BAD_LOGIN, ip);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    }

    const locked = await drive("/login", BAD_LOGIN, ip);
    expect(locked.status).toBe(429);
    expect(locked.body.message).toBe("IP blocked");
    expect(locked.body.retryAfter).toBeGreaterThan(0);

    // The locked request never reached the handler.
    expect(Users.findOne).toHaveBeenCalledTimes(n);

    // Only that address: another one is still answered on the merits.
    const other = await drive("/login", BAD_LOGIN, "198.51.100.11");
    expect(other.status).toBe(401);
  });

  it("does not hold a server fault (5xx) against the caller", async () => {
    Users.findOne.mockRejectedValue(new Error("connection terminated"));
    const ip = "198.51.100.12";

    for (let i = 0; i < ipLimit("login") + 2; i += 1) {
      expect((await drive("/login", BAD_LOGIN, ip)).status).toBe(500);
    }
  });

  it("does not let a successful login clear the address's failure count", async () => {
    const ip = "198.51.100.13";
    const n = ipLimit("login");

    for (let i = 0; i < n - 1; i += 1) {
      expect((await drive("/login", BAD_LOGIN, ip)).status).toBe(401);
    }
    // An MFA-enabled account passes the password step without a session,
    // which keeps this case free of a database. (The backend answers it 200
    // with data.mfaRequired, not the 202 auth.service returns — login() in
    // response.util always sends 200; the frontend keys on mfaRequired.)
    const { hashPassword } = require("../../utils/password.util");
    Users.findOne.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      email: "real@hospital.example.com",
      password: await hashPassword("Right-password-1"),
      isActive: true,
      status: "ACTIVE",
      mfaEnabled: true,
      update: jest.fn().mockResolvedValue({}),
    });
    const ok = await drive(
      "/login",
      { user: "real@hospital.example.com", password: "Right-password-1" },
      ip,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.mfaRequired).toBe(true);

    // One more failure reaches the limit: the success reset nothing per-IP.
    expect((await drive("/login", BAD_LOGIN, ip)).status).toBe(401);
    expect((await drive("/login", BAD_LOGIN, ip)).status).toBe(429);
  });

  it("with no req.ip, counts against the socket address and logs the failure without an ip", async () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    logger.warn.mockClear();
    const driveFromSocket = (remoteAddress) =>
      new Promise((resolve) => {
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            resolve({ status: this.statusCode, body: payload });
            return this;
          },
          setHeader() {
            return this;
          },
        };
        authRouter.handle(
          {
            method: "POST",
            url: "/login",
            body: BAD_LOGIN,
            query: {},
            params: {},
            headers: {},
            socket: { remoteAddress },
            get: () => undefined,
          },
          res,
          () => resolve({ status: 404 }),
        );
      });

    for (let i = 0; i < ipLimit("login"); i += 1) {
      expect((await driveFromSocket("198.51.100.30")).status).toBe(401);
    }
    expect((await driveFromSocket("198.51.100.30")).status).toBe(429);
    expect(logger.warn).toHaveBeenCalledWith("Authentication attempt failed", {
      endpoint: "login",
      status: 401,
      reason: "Invalid credentials",
      ip: null,
    });
  });

  it("does not count the send-OTP resend wait (a 429 from the handler) as a failure", async () => {
    const authService = require("../../services/auth.service");
    jest
      .spyOn(authService, "requestOTP")
      .mockRejectedValue(Object.assign(new Error("Please wait before requesting another OTP"), { status: 429 }));
    const ip = "198.51.100.31";

    for (let i = 0; i < ipLimit("forgotPassword") + 2; i += 1) {
      const res = await drive("/send-otp", { email: "a@hospital.example.com" }, ip);
      expect(res.status).toBe(429);
      expect(res.body.message).toBe("Please wait before requesting another OTP");
    }
  });

  it.each([
    ["/register", "register", {}],
    ["/send-otp", "forgotPassword", {}],
    ["/reset-password", "resetPassword", {}],
  ])("failed %s requests lock the IP too", async (url, endpoint, body) => {
    const ip = "198.51.100.20";
    const n = ipLimit(endpoint);

    for (let i = 0; i < n; i += 1) {
      const res = await drive(url, body, ip);
      expect(res.status).toBe(400);
    }

    expect((await drive(url, body, ip)).status).toBe(429);
    expect((await drive(url, body, "198.51.100.21")).status).toBe(400);
  });
});
