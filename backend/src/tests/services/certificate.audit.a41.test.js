/**
 * A-41 — every certificate mutation writes its audit row INSIDE the same
 * transaction as the change (MEMORY/specs/A-41-audit-inside-transaction.md,
 * rows 1–7).
 *
 * Effects, not calls: the auditLedger fixture enforces the real audit_logs
 * ENUM and commits only what a real transaction would. `cls: false` — every
 * write must pass `{ transaction }` explicitly, or it autocommits and the
 * rollback assertions catch it.
 *
 * The certificate double uses the REAL model transition methods
 * (models/certificate.model.js), so the legal-transition rules are the
 * model's, not the test's.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, certificate: null };

jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(async () => mockRef.certificate),
    create: jest.fn(async (values, options) => {
      mockRef.ledger.write("certificates", { op: "create", ...values }, options);
      return { id: "cert-new", ...values };
    }),
    generateCertificateNumber: jest.fn(async () => "CERT-T-0001"),
    STATUS: {
      DRAFT: "draft",
      PENDING_APPROVAL: "pending_approval",
      APPROVED: "approved",
      SIGNED: "signed",
      REVOKED: "revoked",
    },
  },
  CalibrationDevice: { findOne: jest.fn(async () => ({ id: "dev-1" })) },
  CalibrationRecord: {},
  Tenant: { findByPk: jest.fn(async () => ({ code: "T" })) },
  User: { findByPk: jest.fn() },
  ESignatureRecord: {
    create: jest.fn(async (values, options) =>
      mockRef.ledger.write("e_signature_records", values, options),
    ),
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  Sequelize: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn(async () => ({ data: { valid: true } })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => true) }));
jest.mock("../../services/workflow.service", () => ({
  startWorkflow: jest.fn(async () => undefined),
}));
jest.mock("../../validators/certificate.validator", () => ({
  validate: (data) => data,
  createCertificateSchema: {},
  updateCertificateSchema: {},
}));

const { Sequelize, DataTypes } = jest.requireActual("sequelize");
const RealCertificate = jest.requireActual("../../models/certificate.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
const certificateService = require("../../services/certificate.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const SNAPSHOT_FIELDS = ["id", "status", "approvedBy", "signedBy", "notes", "digitalSignature"];

const makeCertificate = (fields) => {
  const cert = {
    id: "cert-1",
    certificateNumber: "CERT-T-0001",
    deviceId: "dev-1",
    calibrationRecordId: "rec-1",
    notes: null,
    ...fields,
  };
  const snapshot = () => Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, cert[k]]));
  cert.save = async (options) => mockRef.ledger.write("certificates", snapshot(), options);
  cert.update = async (values, options) => {
    Object.assign(cert, values);
    return cert.save(options);
  };
  cert.destroy = async (options) =>
    mockRef.ledger.write("certificates", { id: cert.id, deleted: true }, options);
  for (const method of ["submitForApproval", "approve", "sign", "revoke"]) {
    cert[method] = RealCertificate.prototype[method];
  }
  return cert;
};

const auth = { authMethod: "password", authPayload: "pw", meaning: "I approve", ipAddress: "10.0.0.1", userAgent: "UA" };
const actor = { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "UA" };

// Each case: the starting status, how to invoke, and the audit row expected.
const CASES = [
  {
    name: "createCertificate (issue)",
    status: null,
    run: () => certificateService.createCertificate("tenant-1", "user-1", { deviceId: "dev-1" }, actor),
    action: "CREATE",
    resourceId: "cert-new",
  },
  {
    name: "updateCertificate",
    status: "draft",
    run: () => certificateService.updateCertificate("tenant-1", "cert-1", { notes: "n", updatedBy: "user-1" }, actor),
    action: "UPDATE",
    resourceId: "cert-1",
  },
  {
    name: "deleteCertificate",
    status: "draft",
    run: () => certificateService.deleteCertificate("tenant-1", "cert-1", actor),
    action: "DELETE",
    resourceId: "cert-1",
  },
  {
    name: "submitCertificateForApproval",
    status: "draft",
    run: () => certificateService.submitCertificateForApproval("tenant-1", "cert-1", actor),
    action: "UPDATE",
    resourceId: "cert-1",
  },
  {
    name: "approveCertificate",
    status: "pending_approval",
    run: () => certificateService.approveCertificate("tenant-1", "cert-1", "user-1", auth),
    action: "APPROVE",
    resourceId: "cert-1",
    signs: true,
  },
  {
    name: "signCertificate",
    status: "approved",
    run: () => certificateService.signCertificate("tenant-1", "cert-1", "sig", "key-1", "user-1", auth),
    action: "APPROVE",
    resourceId: "cert-1",
    signs: true,
  },
  {
    name: "revokeCertificate",
    status: "signed",
    run: () => certificateService.revokeCertificate("tenant-1", "cert-1", "wrong device", "user-1", auth),
    action: "UPDATE",
    resourceId: "cert-1",
    signs: true,
  },
];

describe("A-41 — certificate mutations audit inside their transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(logger, "info").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ status, run, action, resourceId, signs }) => {
    beforeEach(() => {
      mockRef.certificate = status ? makeCertificate({ status }) : null;
    });

    it("commits the change together with exactly one valid audit row naming the actor", async () => {
      await run();

      expect(mockRef.ledger.committed("certificates").length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-1",
          action,
          resourceType: "Certificate",
          resourceId,
          ipAddress: "10.0.0.1",
          userAgent: "UA",
        }),
      ]);
      const [row] = mockRef.ledger.auditRows();
      expect(row.changes).toEqual(expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }));
      // Never the re-authentication secret.
      expect(JSON.stringify(row.changes)).not.toContain("pw");
    });

    it("a failing audit insert rolls the certificate change back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed("certificates")).toEqual([]);
      expect(mockRef.ledger.committed("e_signature_records")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    if (signs) {
      it("a rolled-back transaction (signature record fails) leaves no audit row and no state change", async () => {
        mockRef.ledger.failNext("e_signature_records", new Error("signature insert failed"));

        await expect(run()).rejects.toThrow("signature insert failed");

        expect(mockRef.ledger.committed("certificates")).toEqual([]);
        expect(mockRef.ledger.auditRows()).toEqual([]);
      });
    } else {
      it("a rolled-back transaction (the change itself fails) leaves no audit row", async () => {
        mockRef.ledger.failNext("certificates", new Error("write failed"));

        await expect(run()).rejects.toThrow("write failed");

        expect(mockRef.ledger.committed("certificates")).toEqual([]);
        expect(mockRef.ledger.auditRows()).toEqual([]);
      });
    }
  });

  it("an approval audit row records before and after status", async () => {
    mockRef.certificate = makeCertificate({ status: "pending_approval" });

    await certificateService.approveCertificate("tenant-1", "cert-1", "user-1", auth);

    const [row] = mockRef.ledger.auditRows();
    expect(row.changes.before).toEqual(expect.objectContaining({ status: "pending_approval" }));
    expect(row.changes.after).toEqual(expect.objectContaining({ status: "approved", approvedBy: "user-1" }));
  });
});
