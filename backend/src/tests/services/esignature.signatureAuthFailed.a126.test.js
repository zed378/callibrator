/**
 * A-126 (ADR-051 Q-15) — a wrong password or MFA code at the moment of signing
 * writes a `SIGNATURE_AUTH_FAILED` audit row (21 CFR 11.300(d): attempts to use
 * signature credentials without authority are detected and reported).
 *
 * Before: certificate.service#verifySignerCredentials — the one re-authentication
 * every signature in the system goes through (certificate approve / sign /
 * revoke, e-signature workflow signing) — answered 401 and recorded nothing.
 *
 * The row must SURVIVE the refusal. A certificate transition re-authenticates
 * inside its own transaction, which the 401 rolls back; the row is therefore
 * written in a transaction of its own and committed before the 401 is thrown.
 * The auditLedger fixture models exactly that: the transition's transaction
 * rolls back, and a test only sees COMMITTED rows.
 *
 * What is real: certificate.service (runTransition, verifySignatureAuth,
 * verifySignerCredentials), eSignature.service#signDocument up to
 * re-authentication, audit.service#logAction, and the audit_logs schema
 * (auditLedger). What is faked: the credential checks (a password is right
 * only if it IS the password), and the rows the services read.
 */
const { createLedger } = require("../fixtures/auditLedger");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const mockRef = { ledger: null };

jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

jest.mock("../../models", () => ({
  Certificate: { findOne: jest.fn() },
  CalibrationDevice: {},
  CalibrationRecord: {},
  Tenant: {},
  User: { findByPk: jest.fn() },
  ESignatureRecord: { create: jest.fn() },
  SignatureWorkflowStep: { findByPk: jest.fn() },
  SignatureWorkflow: { findByPk: jest.fn() },
  SignatureRecord: { create: jest.fn() },
  Sequelize: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

const PASSWORD = "Correct-horse-1";
const MFA_CODE = "424242";

jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn(async (userId, password) => ({ data: { valid: password === "Correct-horse-1" } })),
}));
jest.mock("../../services/mfa.service", () => ({
  verifyLogin: jest.fn(async (user, code) => code === "424242"),
}));
jest.mock("../../services/webhook.service", () => ({ dispatch: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Certificate, User, SignatureWorkflowStep } = require("../../models");
const certificateService = require("../../services/certificate.service");
const eSignatureService = require("../../services/eSignature.service");

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const SIGNER = "11111111-1111-4111-8111-111111111111";
const CERT_ID = "33333333-3333-4333-8333-333333333333";

const failures = () => mockRef.ledger.auditRows().filter((r) => r.action === "SIGNATURE_AUTH_FAILED");

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  User.findByPk.mockResolvedValue({
    id: SIGNER,
    tenantId: TENANT_ID,
    isActive: true,
    status: "ACTIVE",
    mfaEnabled: true,
    mfaSecret: "S",
  });
});

describe("A-126: a wrong signing credential writes SIGNATURE_AUTH_FAILED", () => {
  it("a wrong password on certificate approval writes one row that survives the refused transition", async () => {
    Certificate.findOne.mockResolvedValue({ id: CERT_ID, tenantId: TENANT_ID, status: "pending_approval" });

    await expect(
      certificateService.approveCertificate(TENANT_ID, CERT_ID, SIGNER, {
        authMethod: "password",
        authPayload: "guess-1",
        meaning: "Approved",
        ipAddress: "198.51.100.20",
        userAgent: "probe",
      }),
    ).rejects.toMatchObject({ status: 401, message: "Invalid password for e-signature." });

    expect(failures()).toHaveLength(1);
    const [row] = failures();
    expect(row).toMatchObject({
      tenantId: TENANT_ID,
      userId: SIGNER,
      actorType: "user",
      action: "SIGNATURE_AUTH_FAILED",
      resourceType: "Certificate",
      resourceId: CERT_ID,
      changes: { method: "password", operation: "approved" },
      ipAddress: "198.51.100.20",
      userAgent: "probe",
    });
    // Never the credential: this table is permanent.
    expect(JSON.stringify(row)).not.toContain("guess-1");
    // Nothing else was committed: the transition itself rolled back.
    expect(mockRef.ledger.rows).toHaveLength(1);
  });

  it("a wrong MFA code on certificate signing writes one row naming the method", async () => {
    Certificate.findOne.mockResolvedValue({ id: CERT_ID, tenantId: TENANT_ID, status: "approved" });

    await expect(
      certificateService.signCertificate(TENANT_ID, CERT_ID, {}, "key-1", SIGNER, {
        authMethod: "mfa",
        authPayload: "000000",
        meaning: "Signed",
      }),
    ).rejects.toMatchObject({ status: 401, message: "Invalid MFA code for e-signature." });

    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      changes: { method: "mfa", operation: "signed" },
      resourceType: "Certificate",
      ipAddress: null,
      userAgent: null,
    });
  });

  it("a wrong password on an e-signature workflow step writes one row about that step", async () => {
    SignatureWorkflowStep.findByPk.mockResolvedValue({
      id: "step-1",
      workflowId: "wf-1",
      tenantId: TENANT_ID,
      signerId: SIGNER,
      status: "pending",
    });

    await expect(
      eSignatureService.signDocument("step-1", SIGNER, {
        authenticationMethod: "password",
        authPayload: "guess-2",
        reason: "Reviewed",
        ipAddress: "203.0.113.4",
        userAgent: "ua",
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      tenantId: TENANT_ID,
      userId: SIGNER,
      resourceType: "SignatureWorkflowStep",
      resourceId: "step-1",
      changes: { method: "password", operation: "sign" },
      ipAddress: "203.0.113.4",
      userAgent: "ua",
    });
  });

  it("a correct credential writes no row", async () => {
    await certificateService.verifySignerCredentials(SIGNER, "password", PASSWORD, { tenantId: TENANT_ID });
    await certificateService.verifySignerCredentials(SIGNER, "mfa", MFA_CODE, { tenantId: TENANT_ID });

    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a missing credential or an account without MFA is not an attempt on a credential — no row", async () => {
    await expect(
      certificateService.verifySignerCredentials(SIGNER, "password", "", { tenantId: TENANT_ID }),
    ).rejects.toMatchObject({ status: 401 });
    User.findByPk.mockResolvedValueOnce({ id: SIGNER, mfaEnabled: false });
    await expect(
      certificateService.verifySignerCredentials(SIGNER, "mfa", MFA_CODE, { tenantId: TENANT_ID }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("with no context the row goes in the signer's own tenant, about the signer", async () => {
    await expect(certificateService.verifySignerCredentials(SIGNER, "password", "nope")).rejects.toMatchObject({
      status: 401,
    });

    expect(User.findByPk).toHaveBeenCalledWith(SIGNER, { attributes: ["id", "tenantId"] });
    expect(failures()[0]).toMatchObject({
      tenantId: TENANT_ID,
      resourceType: "User",
      resourceId: SIGNER,
      changes: { method: "password", operation: null },
    });
  });

  it("with no context and no readable signer the row goes under PLATFORM (ADR-051 Q-14)", async () => {
    User.findByPk.mockResolvedValueOnce(null);
    await expect(certificateService.verifySignerCredentials(SIGNER, "password", "nope")).rejects.toMatchObject({
      status: 401,
    });
    User.findByPk.mockResolvedValueOnce({ id: SIGNER, tenantId: null });
    await expect(certificateService.verifySignerCredentials(SIGNER, "password", "nope")).rejects.toMatchObject({
      status: 401,
    });

    expect(failures().map((r) => r.tenantId)).toEqual([PLATFORM_TENANT_ID, PLATFORM_TENANT_ID]);
  });

  it("an attempt that cannot be recorded is not answered: the audit failure propagates, not the 401", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(
      certificateService.verifySignerCredentials(SIGNER, "password", "nope", { tenantId: TENANT_ID }),
    ).rejects.toThrow("audit insert failed");
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});
