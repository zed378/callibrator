/**
 * Q-08 (ADR-084) — session fixation is structurally impossible, and this pins
 * why.
 *
 * Fixation needs a session identifier that exists BEFORE authentication and
 * survives it. Here a session identifier (`sid`) is only ever minted by the
 * server when authentication completes, and it is a new session row every
 * time:
 *  - the password step of an MFA account issues an "mfa" purpose token with
 *    NO `sid` and creates no session (A-59) — nothing an attacker could plant;
 *  - the MFA step that completes the sign-in creates a new session and signs
 *    its id into the access token;
 *  - two sign-ins of the same account get two different sessions: a sign-in
 *    never adopts an existing one.
 *
 * What is real: auth.service (loginUser, loginMfa), audit.service over the
 * auditLedger fixture, the JWT utilities. Faked: the user row, createSession
 * (it returns a fresh id per call, as the database would), bcrypt, TOTP.
 */
const jwt = require("jsonwebtoken");
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, seq: 0 };

// A-288 (ADR-100): the network policy has its own suites (signInPolicy.*.a288); here it permits.
jest.mock("../../services/signInPolicy.service", () => ({ assertSignInPermitted: jest.fn(async () => undefined) }));
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
  createSession: jest.fn(async () => {
    mockRef.seq += 1;
    return { id: `33333333-3333-4333-8333-${String(mockRef.seq).padStart(12, "0")}` };
  }),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async (plain, hash) => plain === "Right-password-1" && hash === "hash"),
}));

jest.mock("../../services/mfa.service", () => ({ consumeCode: jest.fn(), consumeRecoveryCode: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const sessionService = require("../../services/session.service");
const mfaService = require("../../services/mfa.service");
const authService = require("../../services/auth.service");
const limiter = require("../../services/rateLimiter.redis.service");
const { verifyAccessToken } = require("../../utils/jwt.util");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

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
  mfaSecret: null,
  role: null,
  update: jest.fn(async (values, options) => mockRef.ledger.write("users", values, options)),
  ...overrides,
});

let account;

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  limiter.clearMemoryStore();
  account = userRow();
  Users.findOne.mockImplementation(async () => account);
  Users.findByPk.mockImplementation(async () => account);
});

const passwordStep = () =>
  authService.loginUser({ user: "ada", password: "Right-password-1", ip: "198.51.100.9", userAgent: "ua" });

describe("Q-08 (ADR-084): no session identifier exists before authentication, and none survives it", () => {
  it("the MFA password step creates no session, and its token names none", async () => {
    account = userRow({ mfaEnabled: true, mfaSecret: "S" });

    const result = await passwordStep();

    expect(result.status).toBe(202);
    expect(sessionService.createSession).not.toHaveBeenCalled();
    expect(jwt.decode(result.token)).not.toHaveProperty("sid");
    // ...and it is not an access token at all (A-59).
    expect(() => verifyAccessToken(result.token)).toThrow();
  });

  it("the MFA step mints a NEW session and signs its id into the access token", async () => {
    account = userRow({ mfaEnabled: true, mfaSecret: "S" });
    await passwordStep();
    mfaService.consumeCode.mockResolvedValue(true);

    const result = await authService.loginMfa(USER_ID, "123456", "198.51.100.9", "ua");

    expect(sessionService.createSession).toHaveBeenCalledTimes(1);
    const created = await sessionService.createSession.mock.results[0].value;
    expect(verifyAccessToken(result.token).sid).toBe(created.id);
  });

  it("two sign-ins of one account get two different sessions — a sign-in never adopts one", async () => {
    const first = await passwordStep();
    const second = await passwordStep();

    const a = verifyAccessToken(first.token).sid;
    const b = verifyAccessToken(second.token).sid;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(sessionService.createSession).toHaveBeenCalledTimes(2);
  });
});
