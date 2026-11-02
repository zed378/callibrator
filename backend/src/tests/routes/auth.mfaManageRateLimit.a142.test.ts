/**
 * A-142 — POST /auth/mfa/setup, /auth/mfa/verify (and the new
 * /auth/mfa/disable) are rate-limited.
 *
 * None of them was throttled. Each checks a code for whoever holds the
 * session — setup-as-rotation and disable a password too — so a stolen
 * session could guess the current TOTP code without limit, and replace or
 * turn off the victim's second factor.
 *
 * They now share one `mfaManage` budget per USER (5 failures / 15 minutes),
 * checked by mfaManagePreCheck after `auth` and recorded by the handler
 * (withAuthOutcome) — the mfaLogin pattern (A-81). Per IP only when
 * AUTH_RATE_LIMIT_BY_IP is "true". Unlike /mfa/login, the lock never writes
 * users.locked_until: it must not lock the real user out of sign-in.
 *
 * Fail-before: the sixth wrong code in the first case was answered 400
 * ("Invalid MFA code"), not 429 — the routes mounted no limiter.
 *
 * What is real: the auth router, mfaManagePreCheck and the limiter (on its
 * in-process fallback — no Redis client is ready in a unit run), the auth
 * controller and its outcome recording, auth.service, mfa.service and the
 * real otplib. What is faked: `auth` (sets req.user) and the user row
 * (`Users.findByPk` / `Users.update` are spied); there is no database.
 */

import type { Request, Response, NextFunction } from "express";

let mockCurrentUserId: string | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: Request & { user?: unknown; sessionId?: string }, _res: Response, next: NextFunction) => {
      req.user = { id: mockCurrentUserId, tenantId: null, role: { name: "TECHNICIAN" } };
      req.sessionId = "sess-mine";
      next();
    },
  };
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  ...jest.requireActual<typeof import("../../middlewares/activityLog.middleware")>(
    "../../middlewares/activityLog.middleware",
  ),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { generateSync } from "otplib";

/* eslint-disable @typescript-eslint/no-require-imports */
const authRouter = require("../../routes/api/auth.route") as { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };
const { Users } = require("../../models") as typeof import("../../models");
const {
  clearMemoryStore,
  mfaManagePreCheck,
} = require("../../services/rateLimiter.redis.service") as typeof import("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants") as typeof import("../../constants/rateLimitConstants");
const { logger } = require("../../middlewares/activityLog.middleware") as { logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock } };
/* eslint-enable @typescript-eslint/no-require-imports */

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const PASSWORD = "correct horse battery staple";

interface HttpResponse {
  status: number;
  body: {
    message?: string;
    success?: boolean;
    status?: number;
    retryAfter?: number;
    data?: {
      recoveryCodes?: string[];
    };
  };
}

const drive = (url: string, body: Record<string, unknown>, ip = "198.51.100.7"): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: HttpResponse["body"]) {
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
    (authRouter as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; message?: string }) => void) => void }).handle(req, res, (err?: { status?: number; message?: string }) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err?.message ?? "no route" },
      }),
    );
  });

const userId = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

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

interface MockUserRow {
  id: string;
  email: string;
  tenantId: string | null;
  password: string;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaPendingSecret: string | null;
  mfaPendingCreatedAt: Date | null;
  mfaLastUsedStep: number | null;
  update: (patch: Record<string, unknown>) => Promise<MockUserRow>;
}

/** A user mid-enrolment: a pending secret, MFA not yet on. */
const enrolling = (id: string): MockUserRow => ({
  id,
  email: `${id}@hospital.example.com`,
  tenantId: null,
  password: `hash:${PASSWORD}`,
  mfaEnabled: false,
  mfaSecret: null,
  mfaPendingSecret: SECRET,
  mfaPendingCreatedAt: new Date(),
  mfaLastUsedStep: null,
  update: jest.fn(async function (this: MockUserRow, patch: Record<string, unknown>) {
    return Object.assign(this, patch);
  }),
});

/** A user with MFA on (for rotation / disable). */
const enrolled = (id: string): MockUserRow => ({
  ...enrolling(id),
  mfaEnabled: true,
  mfaSecret: SECRET,
  mfaPendingSecret: null,
  mfaPendingCreatedAt: null,
});

const ORIGINAL_BY_IP = process.env["AUTH_RATE_LIMIT_BY_IP"];
const MAX = getAuthConfig("mfaManage").maxAttempts;
let rows: Map<string, MockUserRow>;

beforeEach(() => {
  delete process.env["AUTH_RATE_LIMIT_BY_IP"];
  clearMemoryStore();
  jest.restoreAllMocks();
  rows = new Map();
  jest.spyOn(Users, "findByPk").mockImplementation(async (id: unknown) => rows.get(id as string) as never || null);
  jest.spyOn(Users, "update").mockResolvedValue([1] as never);
  // No database: the promotion's transaction runs its callback directly.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { db } = require("../../config") as { db: { transaction: (fn: (tx: { id: string }) => Promise<unknown>) => Promise<unknown> } };
  jest.spyOn(db, "transaction").mockImplementation(async (fn: (tx: { id: string }) => Promise<unknown>) => fn({ id: "tx" }));
  const password = require("../../utils/password.util") as {
    comparePassword: (plain: string, hash: string) => Promise<boolean>;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  jest
    .spyOn(password, "comparePassword")
    .mockImplementation(async (plain: string, hash: string) => hash === `hash:${plain}`);
});

afterAll(() => {
  if (ORIGINAL_BY_IP === undefined) {
    delete process.env["AUTH_RATE_LIMIT_BY_IP"];
  } else {
    process.env["AUTH_RATE_LIMIT_BY_IP"] = ORIGINAL_BY_IP;
  }
  jest.restoreAllMocks();
});

describe("A-142: wrong codes on the signed-in MFA endpoints are counted and lock", () => {
  it(`after ${MAX} wrong codes on /mfa/verify the next attempt is 429 — even with the right code`, async () => {
    const id = userId(1);
    mockCurrentUserId = id;
    rows.set(id, enrolling(id));

    for (let i = 0; i < MAX; i += 1) {
      const res = await drive("/mfa/verify", { code: wrongCode() });
      expect(res.status).toBe(400);
    }

    const locked = await drive("/mfa/verify", { code: generateSync({ secret: SECRET }) });
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ success: false, status: 429, retryAfter: expect.any(Number) });
    // The right code was never looked at: MFA is still off.
    expect(rows.get(id)!.mfaEnabled).toBe(false);
  });

  it("setup (a rotation's re-authentication), verify and disable share ONE budget", async () => {
    const id = userId(2);
    mockCurrentUserId = id;
    rows.set(id, enrolled(id));

    // Spread the guesses: 2 on setup, 2 on disable, 1 on verify.
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["/mfa/setup", { currentPassword: PASSWORD, code: wrongCode() }],
      ["/mfa/setup", { currentPassword: "guess", code: wrongCode() }],
      ["/mfa/disable", { currentPassword: PASSWORD, code: wrongCode() }],
      ["/mfa/disable", { currentPassword: PASSWORD, recoveryCode: "AAAA-BBBB-CCCC-DDDD" }],
      ["/mfa/verify", { code: wrongCode() }],
    ];
    expect(attempts).toHaveLength(MAX);
    for (const [url, body] of attempts) {
      const res = await drive(url, body);
      expect(res.status).toBe(400);
    }

    for (const url of ["/mfa/setup", "/mfa/verify", "/mfa/disable"]) {
      const res = await drive(url, {
        currentPassword: PASSWORD,
        code: generateSync({ secret: SECRET }),
      });
      expect({ url, status: res.status }).toEqual({ url, status: 429 });
    }
    // Still enrolled: the lock held on disable.
    expect(rows.get(id)!.mfaEnabled).toBe(true);
  });

  it("the budget is per user: another user is not affected", async () => {
    const a = userId(3);
    const b = userId(4);
    rows.set(a, enrolling(a));
    rows.set(b, enrolling(b));

    mockCurrentUserId = a;
    for (let i = 0; i < MAX; i += 1) {
      await drive("/mfa/verify", { code: wrongCode() });
    }
    expect((await drive("/mfa/verify", { code: wrongCode() })).status).toBe(429);

    mockCurrentUserId = b;
    const res = await drive("/mfa/verify", { code: generateSync({ secret: SECRET }) });
    expect(res.status).toBe(200);
    // A-141: the enrolment returned the recovery codes.
    expect(res.body.data!.recoveryCodes).toHaveLength(10);
  });

  it("the lock is the endpoint's own — it never writes users.locked_until (sign-in stays open)", async () => {
    const id = userId(5);
    mockCurrentUserId = id;
    rows.set(id, enrolling(id));

    for (let i = 0; i < MAX + 1; i += 1) {
      await drive("/mfa/verify", { code: wrongCode() });
    }

    const lockWrites = (Users.update as jest.Mock).mock.calls.filter(([values]: [Record<string, unknown>]) => "lockedUntil" in values);
    expect(lockWrites).toEqual([]);
  });

  it("a success clears the count (and does not touch a sign-in lock)", async () => {
    const id = userId(6);
    mockCurrentUserId = id;
    rows.set(id, enrolling(id));

    for (let i = 0; i < MAX - 1; i += 1) {
      await drive("/mfa/verify", { code: wrongCode() });
    }
    expect((await drive("/mfa/setup", {})).status).toBe(200); // first enrolment: no code needed
    for (let i = 0; i < MAX - 1; i += 1) {
      expect((await drive("/mfa/verify", { code: wrongCode() })).status).toBe(400);
    }
    const lockWrites = (Users.update as jest.Mock).mock.calls.filter(([values]: [Record<string, unknown>]) => "lockedUntil" in values);
    expect(lockWrites).toEqual([]);
  });
});

describe("A-142: per IP only when AUTH_RATE_LIMIT_BY_IP is on", () => {
  const spread = async (ip: string) => {
    // MAX * 3 failures from one address, spread over users that each stay
    // under their own limit — only an address counter can catch this.
    let n = 100;
    for (let i = 0; i < MAX * 3; i += 1) {
      if (i % (MAX - 1) === 0) {
        n += 1;
        mockCurrentUserId = userId(n);
        rows.set(mockCurrentUserId, enrolling(mockCurrentUserId));
      }
      await drive("/mfa/verify", { code: wrongCode() }, ip);
    }
    n += 1;
    mockCurrentUserId = userId(n);
    rows.set(mockCurrentUserId, enrolling(mockCurrentUserId));
    return drive("/mfa/verify", { code: wrongCode() }, ip);
  };

  it("off (the default): one address spreading guesses over many users is not locked", async () => {
    const res = await spread("203.0.113.50");
    expect(res.status).toBe(400);
  });

  it("on: the address is locked", async () => {
    process.env["AUTH_RATE_LIMIT_BY_IP"] = "true";
    const res = await spread("203.0.113.51");
    expect(res.status).toBe(429);
  });
});

describe("A-142: mfaManagePreCheck edges", () => {
  it("with no authenticated user it keys nothing and lets the request through", async () => {
    const next = jest.fn();
    const req = { ip: "198.51.100.1" };

    await (mfaManagePreCheck() as unknown as (req: unknown, res: unknown, next: unknown) => Promise<void>)(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as { rateLimitContext?: unknown }).rateLimitContext).toMatchObject({ userId: null, ip: null, endpoint: "mfaManage" });
  });

  it("a fault in the check is logged and does not become a 500", async () => {
    const next = jest.fn();
    const req = {};
    Object.defineProperty(req, "user", {
      get() {
        throw new Error("boom");
      },
    });

    await (mfaManagePreCheck() as unknown as (req: unknown, res: unknown, next: unknown) => Promise<void>)(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("MFA management pre-check error: boom");
  });
});
