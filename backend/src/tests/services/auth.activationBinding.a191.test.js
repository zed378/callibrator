/**
 * A-191 — an activation link verifies the address it was mailed to, and no
 * other.
 *
 * Before: the activation token carried only the user id. A registration link
 * never followed still verified the account after its email had been
 * rectified (GDPR Art. 16, gdpr.service#rectifyData) to a new address — so
 * whoever read the OLD mailbox marked the NEW, unproven one as verified.
 *
 * What is real: jwt.util (real signing and purpose checks), the claims helper
 * (activationToken.util), auth.service#activateAccount and #registerUser,
 * audit.service#logAction against the audit schema (auditLedger fixture).
 * What is faked: the user rows, Redis and the mail queue.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null };

// registerUser opens an UNMANAGED transaction (no callback) — a stand-in with
// the shape it uses; every managed one goes through the ledger.
jest.mock("../../config", () => ({
  db: {
    transaction: (...args) =>
      typeof args[0] === "function"
        ? mockRef.ledger.transaction(...args)
        : Promise.resolve({
            LOCK: { UPDATE: "UPDATE" },
            finished: undefined,
            commit() {
              this.finished = "commit";
            },
            rollback() {
              this.finished = "rollback";
            },
          }),
  },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  Role: {},
  User: {},
  Tenants: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual("../../services/redis.service");
  return {
    acquireLock: jest.fn(async () => "lock-id"),
    releaseLock: jest.fn(async () => undefined),
    set: jest.fn(async () => true),
    del: jest.fn(async () => true),
    cacheKeys: actual.cacheKeys,
  };
});

jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn(),
  queueOtpEmail: jest.fn(),
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(async () => "hash"),
  comparePassword: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users } = require("../../models");
const { queueActivationEmail } = require("../../services/emailQueue.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");
const { generatePurposeToken, verifyPurposeToken } = require("../../utils/jwt.util");
const { activationClaims, activationEmailHash } = require("../../utils/activationToken.util");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const REGISTERED = "ada@hospital.example.com";
const RECTIFIED = "ada.lovelace@hospital.example.com";

/** An account row whose update is a real write into the ledger. */
const account = (overrides = {}) => {
  const row = {
    id: USER_ID,
    tenantId: TENANT_ID,
    username: "adalovelace",
    email: REGISTERED,
    isEmailVerified: false,
    ...overrides,
  };
  row.update = jest.fn(async (values, options) => {
    await mockRef.ledger.write("users", values, options);
    Object.assign(row, values);
  });
  return row;
};

const tokenFromRegistration = async () => {
  Users.findOne.mockResolvedValue(null);
  Users.create.mockResolvedValue({ id: USER_ID });
  await authService.registerUser(
    {
      firstName: "Ada",
      lastName: "Lovelace",
      username: "adalovelace",
      email: REGISTERED,
      password: "Str0ngPassw0rd",
    },
    "https://app.hospital.test",
  );
  const { activationLink } = queueActivationEmail.mock.calls[0][0];
  return new URL(activationLink).searchParams.get("token");
};

const activate = (token) =>
  authService.activateAccount(token).then(
    (r) => ({ status: r.status, message: r.message }),
    (e) => ({ status: e.status, message: e.message }),
  );

const verifiedWrites = () => mockRef.ledger.committed("users").filter((w) => w.isEmailVerified === true);

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
});

describe("A-191: the activation token names the address it was mailed to", () => {
  it("registration mails a token whose `eh` is the hash of the registration address — not the address", async () => {
    const token = await tokenFromRegistration();

    const claims = verifyPurposeToken(token, "activation");
    expect(claims.id).toBe(USER_ID);
    expect(claims.eh).toBe(activationEmailHash(REGISTERED));
    expect(JSON.stringify(claims)).not.toContain("ada@");
  });

  it("the hash ignores case and surrounding space, as every writer stores the address", () => {
    expect(activationEmailHash("  ADA@Hospital.Example.com ")).toBe(activationEmailHash(REGISTERED));
    expect(activationClaims(USER_ID, REGISTERED)).toEqual({
      id: USER_ID,
      eh: activationEmailHash(REGISTERED),
    });
  });
});

describe("A-191: activation verifies only the address the link was sent to", () => {
  it("the registration link verifies the account while the address is unchanged — audited in the same transaction", async () => {
    const token = await tokenFromRegistration();
    Users.findByPk.mockResolvedValue(account());

    expect(await activate(token)).toEqual({ status: 200, message: "Account activated successfully" });

    expect(verifiedWrites()).toHaveLength(1);
    const rows = mockRef.ledger.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      action: "UPDATE",
      resourceType: "User",
      resourceId: USER_ID,
      changes: { operation: "EMAIL_VERIFIED", method: "activation_link" },
    });
  });

  it("an unused registration link does NOT verify an address rectified after it was sent", async () => {
    const token = await tokenFromRegistration();
    Users.findByPk.mockResolvedValue(account({ email: RECTIFIED }));

    expect(await activate(token)).toEqual({
      status: 400,
      message: "This activation link was sent to an address this account no longer uses",
    });
    expect(verifiedWrites()).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("the rectification's own link (bound to the new address) verifies it", async () => {
    const token = generatePurposeToken(activationClaims(USER_ID, RECTIFIED), "activation");
    Users.findByPk.mockResolvedValue(account({ email: RECTIFIED }));

    expect((await activate(token)).status).toBe(200);
    expect(verifiedWrites()).toHaveLength(1);
  });

  it("a token minted before the binding (no `eh`) is refused", async () => {
    const legacy = generatePurposeToken({ id: USER_ID }, "activation");
    Users.findByPk.mockResolvedValue(account());

    expect((await activate(legacy)).status).toBe(400);
    expect(verifiedWrites()).toEqual([]);
  });

  it("an account already verified answers 'already activated' and writes nothing", async () => {
    const token = await tokenFromRegistration();
    Users.findByPk.mockResolvedValue(account({ isEmailVerified: true }));

    expect(await activate(token)).toEqual({ status: 200, message: "Account already activated" });
    expect(mockRef.ledger.committed("users")).toEqual([]);
  });

  it("a tenant-less account (self-registration) is verified with an error log instead of a row", async () => {
    const token = await tokenFromRegistration();
    Users.findByPk.mockResolvedValue(account({ tenantId: null }));

    expect((await activate(token)).status).toBe(200);
    expect(verifiedWrites()).toHaveLength(1);
    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Credential change not audited: the user has no tenant",
      { userId: USER_ID, operation: "EMAIL_VERIFIED" },
    );
  });
});
