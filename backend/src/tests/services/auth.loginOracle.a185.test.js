/**
 * A-185 — a failed password sign-in says nothing about the account, and
 * nobody but the password holder can lock the owner out.
 *
 * Before: the fifth wrong password for a REAL username wrote
 * users.locked_until and answered 423 "Account locked…", while an unknown
 * username answered 401 forever — an existence oracle. The same lock was a
 * denial of service anyone could aim: five requests from anywhere locked the
 * owner out everywhere for fifteen minutes, repeatable indefinitely. A
 * suspended account answered 403 "Account is suspended" to ANY password.
 *
 * What is real: auth.service#loginUser, the throttle
 * (rateLimiter.redis.service on its in-process store — no Redis is ready in a
 * unit run), audit.service#recordAccountLock and logAction with the audit
 * schema enforced by the auditLedger fixture, and the Joi login schema.
 * What is faked: the user rows, createSession and bcrypt (comparePassword
 * answers true only for RIGHT against the stored "hash").
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null };

jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
  Role: {},
  User: {},
  Tenants: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" })),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const { comparePassword } = require("../../utils/password.util");
const authService = require("../../services/auth.service");
const limiter = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const RIGHT = "Right-password-1";
const WRONG = "Wrong-password-1";

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  tenant: { id: TENANT_ID, status: "active" },
  username: "ada",
  email: "ada@hospital.example.com",
  password: "hash",
  isActive: true,
  status: "ACTIVE",
  failedLoginAttempts: 0,
  lockedUntil: null,
  mfaEnabled: false,
  role: null,
  update: jest.fn(async (values, options) => mockRef.ledger.write("users", values, options)),
  ...overrides,
});

/** The account table: "ada" (or her address) exists; nothing else does. */
let account;
const lookup = async ({ where }) => {
  const [byName] = where[Object.getOwnPropertySymbols(where)[0]];
  const typed = byName.username;
  return account && (typed === account.username || typed === account.email) ? account : null;
};

const attempt = (user, password, ip = "198.51.100.7") =>
  authService
    .loginUser({ user, password, ip, userAgent: "probe" })
    .then((result) => ({ status: result.status, message: result.message }))
    .catch((e) => ({ status: e.status, message: e.message }));

const lockRows = () => mockRef.ledger.auditRows().filter((r) => r.action === "ACCOUNT_LOCKED");
const lockWrites = () => mockRef.ledger.committed("users").filter((r) => r.lockedUntil);

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  limiter.clearMemoryStore();
  account = userRow();
  Users.findOne.mockImplementation(lookup);
  comparePassword.mockImplementation(async (plain, hash) => plain === RIGHT && hash === "hash");
});

describe("A-185: a real username and an invented one are indistinguishable", () => {
  it("ten wrong passwords from one address get the same answers, in the same order, for both", async () => {
    const real = [];
    const invented = [];
    for (let i = 0; i < 10; i += 1) {
      real.push(await attempt("ada", WRONG));
      invented.push(await attempt("nobody-here", WRONG));
    }

    expect(real).toEqual(invented);
    const max = getAuthConfig("login").maxAttempts;
    expect(real.slice(0, max).every((r) => r.status === 401 && r.message === "Invalid credentials")).toBe(true);
    expect(real.slice(max).every((r) => r.status === 429 && r.message === authService.SIGN_IN_PAUSED)).toBe(
      true,
    );
    // Never the 423 that only a real account used to get.
    expect(real.some((r) => r.status === 423)).toBe(false);
  });

  it("the identifier ceiling pauses a real name and an invented one alike, whatever the address", async () => {
    const ceiling = getAuthConfig("loginIdentifier").maxAttempts;
    for (let i = 0; i < ceiling; i += 1) {
      const ip = `10.0.${Math.floor(i / 250)}.${i % 250}`;
      expect((await attempt("ada", WRONG, ip)).status).toBe(401);
      expect((await attempt("nobody-here", WRONG, ip)).status).toBe(401);
    }

    expect(await attempt("ada", WRONG, "203.0.113.200")).toEqual({
      status: 429,
      message: authService.SIGN_IN_PAUSED,
    });
    expect(await attempt("nobody-here", WRONG, "203.0.113.200")).toEqual({
      status: 429,
      message: authService.SIGN_IN_PAUSED,
    });
  });

  it("a suspended account with a wrong password answers 401 like any other failure (was 403 to any password)", async () => {
    account = userRow({ status: "SUSPENDED" });

    expect(await attempt("ada", WRONG)).toEqual({ status: 401, message: "Invalid credentials" });
    // The right password is told the truth.
    expect(await attempt("ada", RIGHT)).toEqual({ status: 403, message: "Account is suspended" });
  });

  it("a deactivated account with a wrong password answers 401", async () => {
    account = userRow({ isActive: false });

    expect((await attempt("ada", WRONG)).status).toBe(401);
  });

  it("an account locked by the MFA step answers 401 to a wrong password, 423 only to the right one", async () => {
    account = userRow({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) });

    expect(await attempt("ada", WRONG)).toEqual({ status: 401, message: "Invalid credentials" });
    expect(await attempt("ada", RIGHT)).toEqual({ status: 423, message: "Account temporarily locked" });
  });

  it("an unknown identifier still pays for a bcrypt comparison, against a real bcrypt hash", async () => {
    await attempt("nobody-here", WRONG);

    expect(comparePassword).toHaveBeenCalledTimes(1);
    expect(comparePassword).toHaveBeenCalledWith(WRONG, authService.UNKNOWN_ACCOUNT_HASH);
    expect(authService.UNKNOWN_ACCOUNT_HASH).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
  });

  it("a paused attempt looks nothing up and compares nothing", async () => {
    for (let i = 0; i < getAuthConfig("login").maxAttempts; i += 1) {
      await attempt("ada", WRONG);
    }
    Users.findOne.mockClear();
    comparePassword.mockClear();

    expect((await attempt("ada", RIGHT)).status).toBe(429);
    expect(Users.findOne).not.toHaveBeenCalled();
    expect(comparePassword).not.toHaveBeenCalled();
  });
});

describe("A-185: nobody can lock the owner out", () => {
  it("anonymous failures never write users.locked_until", async () => {
    for (let i = 0; i < 12; i += 1) {
      await attempt("ada", WRONG, `192.0.2.${i}`);
    }

    expect(lockWrites()).toEqual([]);
    expect(Users.update).not.toHaveBeenCalled();
    expect(account.update).not.toHaveBeenCalled();
  });

  it("after a pause from one address, the owner signs in from another", async () => {
    for (let i = 0; i < 7; i += 1) {
      await attempt("ada", WRONG, "198.51.100.66");
    }
    expect((await attempt("ada", RIGHT, "198.51.100.66")).status).toBe(429);

    expect(await attempt("ada", RIGHT, "203.0.113.5")).toEqual({
      status: 200,
      message: "Login successful",
    });
  });

  it("the pause is keyed on the identifier as typed, trimmed and without case", async () => {
    for (let i = 0; i < getAuthConfig("login").maxAttempts; i += 1) {
      await attempt(i % 2 ? "ADA" : " ada ", WRONG);
    }

    expect((await attempt("Ada", WRONG)).status).toBe(429);
  });

  it("a success clears its own pair, so four earlier typos do not carry over", async () => {
    const max = getAuthConfig("login").maxAttempts;
    for (let i = 0; i < max - 1; i += 1) {
      await attempt("ada", WRONG);
    }
    expect((await attempt("ada", RIGHT)).status).toBe(200);

    for (let i = 0; i < max - 1; i += 1) {
      expect((await attempt("ada", WRONG)).status).toBe(401);
    }
  });
});

describe("A-185 with A-126: the pause of a real account is audited, invisibly", () => {
  it("the attempt that fills the pair writes one ACCOUNT_LOCKED row in the account's tenant, naming the scope", async () => {
    const max = getAuthConfig("login").maxAttempts;
    for (let i = 0; i < max + 3; i += 1) {
      await attempt("ada", WRONG);
    }

    expect(lockRows()).toHaveLength(1);
    expect(lockRows()[0]).toMatchObject({
      tenantId: TENANT_ID,
      userId: null,
      actorType: "system",
      actorName: "system:auth-lockout",
      resourceType: "User",
      resourceId: USER_ID,
      changes: {
        endpoint: "login",
        failedAttempts: max,
        scope: "identifier+address",
        lockedUntil: expect.any(String),
      },
      ipAddress: "198.51.100.7",
      userAgent: "probe",
    });
  });

  it("filling the identifier ceiling writes a row with scope 'identifier'", async () => {
    const ceiling = getAuthConfig("loginIdentifier").maxAttempts;
    for (let i = 0; i < ceiling; i += 1) {
      await attempt("ada", WRONG, `10.1.${Math.floor(i / 250)}.${i % 250}`);
    }

    expect(lockRows().map((r) => r.changes.scope)).toEqual(["identifier"]);
  });

  it("an invented identifier is paused but never gets a row", async () => {
    for (let i = 0; i < 8; i += 1) {
      await attempt("nobody-here", WRONG);
    }

    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});
