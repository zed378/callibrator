/**
 * A-60 — POST /api/v1/auth/sso/exchange, driven through the real auth router.
 *
 * The SSO callbacks now redirect with a one-time code instead of an access and
 * refresh token; the frontend server posts the code here. These cases drive the
 * route's REAL middleware chain — the auth rate-limit pre-check, validate(),
 * and the controller — through Express's own `router.handle` (supertest is not
 * a dependency of this workspace; routeGuards.a28.test.js does the same).
 *
 * What is real: the router, rateLimiter.redis.service (on its in-process
 * fallback, because no Redis client is ready in a unit run), the Joi schema,
 * validation.middleware, the controller and the hand-off store (also on its
 * in-process fallback, via redis.service's real "not ready" answers).
 *
 * What is not exercised: a successful exchange, which creates a session row —
 * that is covered in sso.controller.test.js and, over a fake pg wire, in
 * auth.tokenPurpose.a59.test.js.
 */

const authRouter = require("../../routes/api/auth.route");
const { clearMemoryStore } = require("../../services/rateLimiter.redis.service");

const exchange = (body, ip = "198.51.100.20") =>
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
    };
    const req = {
      method: "POST",
      url: "/sso/exchange",
      originalUrl: "/api/v1/auth/sso/exchange",
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

const WELL_FORMED_UNKNOWN = "Z".repeat(43);

const ORIGINAL_BY_IP = process.env.AUTH_RATE_LIMIT_BY_IP;

beforeEach(() => {
  delete process.env.AUTH_RATE_LIMIT_BY_IP;
  clearMemoryStore();
});

afterAll(() => {
  if (ORIGINAL_BY_IP === undefined) {
    delete process.env.AUTH_RATE_LIMIT_BY_IP;
  } else {
    process.env.AUTH_RATE_LIMIT_BY_IP = ORIGINAL_BY_IP;
  }
});

describe("A-60: POST /auth/sso/exchange", () => {
  it("is registered, public, and gated by the rate-limit pre-check and validate()", () => {
    const layer = authRouter.stack.find(
      (l) => l.route && l.route.path === "/sso/exchange" && l.route.methods.post,
    );
    expect(layer).toBeDefined();
    // pre-check, validate, controller — no `auth`: the code is the credential.
    expect(layer.route.stack).toHaveLength(3);
  });

  it("refuses a body that is not a hand-off code with 400", async () => {
    for (const body of [
      undefined,
      {},
      { code: "short" },
      { code: `${"a".repeat(42)}!` },
      { code: 12345 },
    ]) {
      const res = await exchange(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Validation Error");
    }
  });

  it("refuses a posted raw token — only a code is accepted", async () => {
    const res = await exchange({ token: "eyJhbGciOiJSUzI1NiJ9.e30.sig" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation Error");
    expect(res.body).not.toHaveProperty("token");
  });

  it("an expired or unknown code is refused with 401 through the route", async () => {
    const res = await exchange({ code: WELL_FORMED_UNKNOWN });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid or expired SSO code");
    expect(res.body).not.toHaveProperty("token");
  });

  it("with AUTH_RATE_LIMIT_BY_IP=true, locks an IP out with 429 after repeated failed exchanges, and only that IP", async () => {
    process.env.AUTH_RATE_LIMIT_BY_IP = "true";
    // ssoExchange: maxAttempts 10; the per-IP lock is at maxAttempts * 3.
    for (let i = 0; i < 30; i += 1) {
      expect((await exchange({ code: WELL_FORMED_UNKNOWN }, "198.51.100.66")).status).toBe(401);
    }
    const locked = await exchange({ code: WELL_FORMED_UNKNOWN }, "198.51.100.66");
    expect(locked.status).toBe(429);

    const other = await exchange({ code: WELL_FORMED_UNKNOWN }, "198.51.100.67");
    expect(other.status).toBe(401);
  });

  // A-100: the exchange counted every failure by IP regardless of the flag.
  // It is called server-to-server by the frontend, so until a deployment's
  // req.ip is known to be the client (A-16) that address may be shared by
  // every browser — and 30 bad codes from anyone locked SSO for everyone.
  it("with AUTH_RATE_LIMIT_BY_IP unset, failed exchanges never lock the address", async () => {
    delete process.env.AUTH_RATE_LIMIT_BY_IP;
    for (let i = 0; i < 40; i += 1) {
      expect((await exchange({ code: WELL_FORMED_UNKNOWN }, "198.51.100.68")).status).toBe(401);
    }
  });

  it("with AUTH_RATE_LIMIT_BY_IP=false, failed exchanges never lock the address", async () => {
    process.env.AUTH_RATE_LIMIT_BY_IP = "false";
    for (let i = 0; i < 40; i += 1) {
      expect((await exchange({ code: WELL_FORMED_UNKNOWN }, "198.51.100.69")).status).toBe(401);
    }
  });
});
