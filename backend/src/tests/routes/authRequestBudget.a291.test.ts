/**
 * A-291 / A-292 (ADR-100) — the public auth endpoints count EVERY request,
 * successes included, and answer the budget's 429 with a Retry-After header.
 *
 * Before ADR-100 a registration, an OTP request or an SSO start that SUCCEEDED
 * was never counted (the failure throttles count failures), and `authLimiter`
 * / `otpLimiter` in index.js were never mounted: each could be repeated
 * without bound behind the global limiter alone.
 *
 * What is real: the auth router, the request budgets, the limiter's store (its
 * in-memory fallback: no Redis client is ready in a unit run). What is doubled:
 * the controllers, which answer 200 — so every counted request here SUCCEEDED.
 * The limits are the production figures (RATE_LIMIT_NON_PRODUCTION_FACTOR=1).
 */
import type { Request, Response } from "express";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as RateLimitConstants from "../../constants/rateLimitConstants";
import { environment } from "../../config/env";

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => void;

const ok: Handler = (_req, res) => {
  res.status(200).json({ success: true });
};
/** Every export of a controller module is `ok`. */
const allOk = (): Record<string, Handler> => new Proxy({}, { get: () => ok });

jest.mock("../../controllers/auth.controller", () => allOk());
jest.mock("../../controllers/sso.controller", () => allOk());

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the auth router is JavaScript (CommonJS)
const authRouter = require("../../routes/api/auth.route") as { handle: (req: object, res: object, done: (err?: unknown) => void) => void };
const rateLimiter = jest.requireActual<typeof RateLimiter>(
  "../../services/rateLimiter.redis.service",
);
const { API_ENDPOINTS } = jest.requireActual<typeof RateLimitConstants>(
  "../../constants/rateLimitConstants",
);

interface Answer {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const drive = (url: string, body: object, ip: string): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload, headers });
        return this;
      },
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return this;
      },
      set(name: string, value: string) {
        headers[name.toLowerCase()] = value;
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
    authRouter.handle(req, res, (err?: unknown) => {
      reject(err instanceof Error ? err : new Error(`fell through ${url}`));
    });
  });

const penv = environment();
const saved = penv["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
beforeAll(() => {
  penv["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
});
afterAll(() => {
  penv["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = saved ?? "";
});
beforeEach(() => {
  rateLimiter.clearMemoryStore();
});

/** Send `limit` successful requests, then one more: it is the budget's 429. */
const exhaust = async (url: string, body: (i: number) => object, ip: string, limit: number): Promise<Answer> => {
  for (let i = 0; i < limit; i += 1) {
    const answer = await drive(url, body(i), ip);
    expect(answer.status).toBe(200);
  }
  return drive(url, body(limit), ip);
};

describe("A-291 — successes are counted, per client address", () => {
  it.each([
    ["/register", "authRegister", (i: number) => ({ email: `u${String(i)}@x.test` })],
    ["/login", "authSignIn", (i: number) => ({ user: `u${String(i)}`, password: "p" })],
    ["/send-otp", "authOtp", (i: number) => ({ email: `u${String(i)}@x.test` })],
    ["/reset-password", "authOtp", (i: number) => ({ email: `u${String(i)}@x.test` })],
    ["/sso/login", "ssoStart", () => ({ tenantCode: "acme" })],
    ["/sso/oidc/login", "ssoStart", () => ({ tenantCode: "acme" })],
    ["/mfa/login", "mfaSignIn", () => ({ token: "t", code: "123456" })],
  ] as const)("POST %s: the (limit+1)th request is 429 with Retry-After", async (url, key, body) => {
    const limit = API_ENDPOINTS[key].maxRequests;
    const over = await exhaust(url, body, "198.51.100.1", limit);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ success: false, status: 429, data: null });
    expect(typeof over.body["retryAfter"]).toBe("number");
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
    // Another address has its own budget.
    expect((await drive(url, body(0), "198.51.100.2")).status).toBe(200);
  });

  it("the SAML and OIDC starts share one budget, so spreading across them buys nothing", async () => {
    const limit = API_ENDPOINTS.ssoStart.maxRequests;
    for (let i = 0; i < limit; i += 1) {
      await drive(i % 2 === 0 ? "/sso/login" : "/sso/oidc/login", { tenantCode: "x" }, "198.51.100.3");
    }
    expect((await drive("/sso/login", { tenantCode: "x" }, "198.51.100.3")).status).toBe(429);
  });
});

describe("A-291 — one mailbox is bounded whoever asks", () => {
  it("send-otp to one address from many addresses stops at the recipient budget, the same whether or not an account has it", async () => {
    const limit = API_ENDPOINTS.authOtpRecipient.maxRequests;
    for (let i = 0; i < limit; i += 1) {
      expect((await drive("/send-otp", { email: " Victim@X.test " }, `203.0.113.${String(i + 1)}`)).status).toBe(200);
    }
    // Case and whitespace do not make a new mailbox.
    const over = await drive("/send-otp", { email: "victim@x.test" }, "203.0.113.200");
    expect(over.status).toBe(429);
    expect(JSON.stringify(over.body)).not.toMatch(/victim/i);
    // A request without an email is not keyed by recipient (the validator answers it).
    expect((await drive("/send-otp", {}, "203.0.113.201")).status).toBe(200);
  });
});
