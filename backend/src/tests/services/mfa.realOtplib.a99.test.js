/**
 * A-99 — MFA against the REAL otplib.
 *
 * otplib 13 has no `authenticator` export. auth.service and mfa.service
 * destructured it anyway, so MFA setup, setup verification and MFA login all
 * threw a TypeError in production. Every test passed because jest.config.js
 * mapped `otplib` to a global mock whose check() accepted any code — the mock
 * invented the contract and then agreed with itself.
 *
 * Nothing here mocks otplib. A code is generated from the secret the service
 * itself produced, by the same library an authenticator app is compatible
 * with, and the service has to accept it — and refuse everything else.
 *
 * What is faked: the models, the transaction, createSession and the logger —
 * as in auth.signInStatus.a83.test.js. qrcode is real.
 */

const mockTx = { id: "tx-a99" };

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (fn) => fn(mockTx)) },
}));

// A-115: consumeCode stamps the used step with a conditional Users.update;
// here it applies to whatever row findByPk last handed out.
const mockTable = { row: null };
jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    findByPk: jest.fn(async () => mockTable.row),
    update: jest.fn(async (values) => {
      Object.assign(mockTable.row, values);
      return [1];
    }),
  },
  User: {},
  Role: {},
  Tenants: { name: "Tenants" },
  AuditLog: { create: jest.fn() },
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const otplib = require("otplib");
const { Users, AuditLog } = require("../../models");
const { createSession } = require("../../services/session.service");
const authService = require("../../services/auth.service");
const mfaService = require("../../services/mfa.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
// Mid-step (xx:00:15), so ±1 step is unambiguous.
const NOW_MS = Date.parse("2026-09-24T10:00:15Z");
const NOW_S = NOW_MS / 1000;

// A row whose update() writes through, so the secret setupMfa stores is the
// one verifyMfaSetup and loginMfa read back.
const makeUser = (overrides = {}) => {
  const row = {
    id: USER_ID,
    tenantId: TENANT_ID,
    tenant: { id: TENANT_ID, status: "active" },
    username: "ada",
    email: "ada@hospital.example.com",
    isActive: true,
    status: "ACTIVE",
    lockedUntil: null,
    mfaEnabled: false,
    mfaSecret: null,
    role: null,
    ...overrides,
  };
  row.update = jest.fn(async (patch) => Object.assign(row, patch));
  mockTable.row = row;
  return row;
};

const codeAt = (secret, epoch) => otplib.generateSync({ secret, epoch });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(NOW_MS);
  createSession.mockResolvedValue({ id: "session-a99" });
  Users.findByPk.mockImplementation(async () => mockTable.row);
  AuditLog.create.mockImplementation(async (row) => ({ toJSON: () => row }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-99: the real otplib, not a mock", () => {
  it("the otplib under test is the real package, not __mocks__/otplib.js", () => {
    expect(otplib.authenticator).toBeUndefined();
    expect(typeof otplib.verifySync).toBe("function");
    expect(require.resolve("otplib")).toMatch(/node_modules[\\/]otplib[\\/]/);
  });

  it("MFA setup, verify and login work with the real otplib", async () => {
    const user = makeUser();
    Users.findByPk.mockResolvedValue(user);

    // 1. setup: a real base32 secret, a real otpauth URI inside a real QR code.
    // A-114: held PENDING, not written to the live mfaSecret.
    const setup = await authService.setupMfa(USER_ID);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/); // 20 bytes, RFC 4226's recommendation
    expect(setup.qrCodeUrl).toMatch(/^data:image\/png;base64,/);
    expect(user.update).toHaveBeenCalledWith({
      mfaPendingSecret: setup.secret,
      mfaPendingCreatedAt: expect.any(Date),
    });
    expect(user.mfaSecret).toBeNull();
    expect(user.mfaEnabled).toBe(false);

    // 2. verify setup with a code an authenticator app would show now.
    const verified = await authService.verifyMfaSetup(USER_ID, codeAt(setup.secret, NOW_S));
    expect(verified).toEqual({ success: true, message: "MFA enabled successfully" });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toBe(setup.secret);

    // 3. MFA login with the enrolled secret. A-115: the code that verified the
    // setup was consumed, so sign-in uses the NEXT step's code.
    await expect(
      authService.loginMfa(USER_ID, codeAt(setup.secret, NOW_S), "203.0.113.9", "jest"),
    ).rejects.toMatchObject({ status: 401 });
    const login = await authService.loginMfa(USER_ID, codeAt(setup.secret, NOW_S + 30), "203.0.113.9", "jest");
    expect(login.status).toBe(200);
    expect(login.data.mfaEnabled).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("the otpauth URI names the issuer, the account and the secret", () => {
    const secret = mfaService.createSecret();
    const uri = mfaService.buildOtpauthUri("ada@hospital.example.com", secret);
    expect(uri).toBe(
      `otpauth://totp/Callibrator:ada%40hospital.example.com?secret=${secret}&issuer=Callibrator`,
    );
  });

  it("a wrong TOTP code is refused by the real otplib", async () => {
    const secret = mfaService.createSecret();
    const good = codeAt(secret, NOW_S);
    const wrong = String((Number(good) + 1) % 1000000).padStart(6, "0");

    // setup verification
    const pending = makeUser({ mfaPendingSecret: secret, mfaPendingCreatedAt: new Date(NOW_MS) });
    await expect(authService.verifyMfaSetup(USER_ID, wrong)).rejects.toMatchObject({
      status: 400,
      message: "Invalid MFA code",
    });
    expect(pending.mfaEnabled).toBe(false);

    // login
    makeUser({ mfaEnabled: true, mfaSecret: secret });
    await expect(authService.loginMfa(USER_ID, wrong)).rejects.toMatchObject({
      status: 401,
      message: "Invalid MFA code",
    });
    expect(createSession).not.toHaveBeenCalled();

    // the certificate-signing check (mfa.service.verifyLogin — async and
    // consuming since A-115)
    const signer = makeUser({ mfaEnabled: true, mfaSecret: secret });
    await expect(mfaService.verifyLogin(signer, wrong)).resolves.toBe(false);
    await expect(mfaService.verifyLogin(signer, good)).resolves.toBe(true);
  });

  it("a code from another secret is refused", async () => {
    const secret = mfaService.createSecret();
    const other = mfaService.createSecret();
    makeUser({ mfaEnabled: true, mfaSecret: secret });

    await expect(authService.loginMfa(USER_ID, codeAt(other, NOW_S))).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each([
    ["five digits", "12345"],
    ["seven digits", "1234567"],
    ["letters", "12ab56"],
    ["empty", ""],
    ["undefined", undefined],
    ["null", null],
    ["an object", { code: "123456" }],
  ])("a malformed code (%s) is a refusal, not a 500", async (_label, code) => {
    const secret = mfaService.createSecret();
    makeUser({ mfaEnabled: true, mfaSecret: secret });

    await expect(authService.loginMfa(USER_ID, code)).rejects.toMatchObject({
      status: 401,
      message: "Invalid MFA code",
    });
  });

  it("a numeric code (JSON number) and surrounding spaces are accepted", () => {
    // 6-digit code without a leading zero, so Number() round-trips it.
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    let epoch = NOW_S;
    while (codeAt(secret, epoch).startsWith("0")) {
      epoch += 30;
    }
    jest.spyOn(Date, "now").mockReturnValue(epoch * 1000);
    const code = codeAt(secret, epoch);

    expect(mfaService.checkCode(Number(code), secret)).toBe(true);
    expect(mfaService.checkCode(` ${code} `, secret)).toBe(true);
  });
});

describe("A-99: clock drift — exactly ±1 time step", () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  it.each([
    ["the previous step (phone 30s behind)", -30, true],
    ["the next step (phone 30s ahead)", 30, true],
    ["two steps back", -60, false],
    ["two steps ahead", 60, false],
    ["five minutes old", -300, false],
  ])("a code from %s: accepted=%s", (_label, offset, accepted) => {
    expect(mfaService.checkCode(codeAt(secret, NOW_S + offset), secret)).toBe(accepted);
  });
});

describe("A-99: secrets already stored stay verifiable", () => {
  it("a legacy 80-bit (16-character) base32 secret still verifies", () => {
    // otplib <= 12 generated 10-byte secrets; v13's default guardrail refuses
    // anything under 16 bytes, which would lock such an account out.
    const legacy = "JBSWY3DPEHPK3PXP";
    const code = otplib.generateSync({
      secret: legacy,
      epoch: NOW_S,
      guardrails: otplib.createGuardrails({ MIN_SECRET_BYTES: 10 }),
    });
    expect(mfaService.checkCode(code, legacy)).toBe(true);
  });

  it("a stored secret that is not base32 is logged and refused, not a 500", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    expect(mfaService.checkCode("123456", "not base32!")).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "TOTP verification failed on the stored secret",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("an absent secret is refused without calling the library", () => {
    expect(mfaService.checkCode("123456", null)).toBe(false);
    expect(mfaService.checkCode("123456", "")).toBe(false);
  });
});
