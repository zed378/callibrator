/**
 * A-64 — a certificate's status cannot be changed by editing it.
 *
 * `updateCertificateSchema.status` used to accept `approved` and `signed`, so
 * `PUT /certificates/:id` moved a certificate into an approved or signed state
 * with no re-authentication, no ESignatureRecord and no approver — a 21 CFR
 * Part 11 bypass. Status now changes only through its own routes
 * (submit / approve / sign / revoke), each of which re-authenticates and audits.
 *
 * The validator is the REAL one (the controller and the service both run it),
 * and the certificate double uses the REAL model transition methods, so nothing
 * here restates the rule under test. Effects are asserted against the
 * auditLedger fixture: what would have been committed, not which mock was called.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, certificate: null };

jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(async () => mockRef.certificate),
    STATUS: {
      DRAFT: "draft",
      PENDING_APPROVAL: "pending_approval",
      APPROVED: "approved",
      SIGNED: "signed",
      REVOKED: "revoked",
    },
  },
  CalibrationDevice: {},
  CalibrationRecord: {},
  Tenant: {},
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

const { Sequelize, DataTypes } = jest.requireActual("sequelize");
const RealCertificate = jest.requireActual("../../models/certificate.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
const certificateService = require("../../services/certificate.service");
const { validate, updateCertificateSchema } = require("../../validators/certificate.validator");
const { logger } = require("../../middlewares/activityLog.middleware");

const makeCertificate = (fields) => {
  const cert = {
    id: "cert-1",
    certificateNumber: "CERT-T-0001",
    deviceId: "dev-1",
    calibrationRecordId: "rec-1",
    summary: "old summary",
    ...fields,
  };
  cert.save = async (options) =>
    mockRef.ledger.write("certificates", { id: cert.id, status: cert.status, summary: cert.summary }, options);
  cert.update = async (values, options) => {
    Object.assign(cert, values);
    return cert.save(options);
  };
  for (const method of ["submitForApproval", "approve", "sign", "revoke"]) {
    cert[method] = RealCertificate.prototype[method];
  }
  return cert;
};

const actor = { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "UA" };

/** What PUT /certificates/:id does: the controller validates, then the service. */
const put = (body) =>
  certificateService.updateCertificate(
    "tenant-1",
    "cert-1",
    { ...validate(body, updateCertificateSchema), updatedBy: "user-1" },
    actor,
  );

describe("A-64 — PUT /certificates/:id cannot change status", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(logger, "info").mockImplementation(() => logger);
  });

  describe.each([
    ["draft", "approved"],
    ["draft", "signed"],
    ["draft", "pending_approval"],
    ["pending_approval", "approved"],
    ["approved", "signed"],
    ["approved", "revoked"],
    ["pending_approval", "draft"],
  ])("from %s to %s", (from, to) => {
    it("a PUT carrying status does not change the status", async () => {
      mockRef.certificate = makeCertificate({ status: from });

      await expect(put({ status: to, summary: "new summary" })).rejects.toMatchObject({
        status: 409,
      });

      expect(mockRef.certificate.status).toBe(from);
      // Nothing committed — not the status, and not the rest of the edit either.
      expect(mockRef.ledger.committed("certificates")).toEqual([]);
      expect(mockRef.ledger.committed("e_signature_records")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });
  });

  it("the 409 explains the certificate's state and names the route that changes it", async () => {
    mockRef.certificate = makeCertificate({ status: "draft" });

    const err = await put({ status: "approved" }).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain('"draft"');
    expect(err.message).toContain("/submit");
  });

  it.each([
    ["pending_approval", "/approve"],
    ["approved", "/sign"],
  ])("a %s certificate's 409 points at %s", async (from, route) => {
    mockRef.certificate = makeCertificate({ status: from });

    const err = await put({ status: "revoked" }).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain(`"${from}"`);
    expect(err.message).toContain(route);
  });

  it("a PUT repeating the current status is not a transition: the edit applies, status unchanged", async () => {
    mockRef.certificate = makeCertificate({ status: "draft" });

    await put({ status: "draft", summary: "new summary" });

    expect(mockRef.ledger.committed("certificates")).toEqual([
      { id: "cert-1", status: "draft", summary: "new summary" },
    ]);
    const [row] = mockRef.ledger.auditRows();
    expect(row.action).toBe("UPDATE");
    // The audit row records the edit, not a pretend status change.
    expect(row.changes.after).not.toHaveProperty("status");
  });

  it("an empty or null status is treated as absent", async () => {
    mockRef.certificate = makeCertificate({ status: "draft" });

    await put({ status: "", summary: "a" });
    await put({ status: null, summary: "b" });

    expect(mockRef.ledger.committed("certificates").map((r) => r.status)).toEqual(["draft", "draft"]);
  });

  it("a certificate that is not the caller's is 404, whatever status the body carries", async () => {
    mockRef.certificate = null; // the tenant hook finds nothing

    const result = await put({ status: "approved" });

    expect(result.status).toBe(404);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a status outside the enum is still a 400 from the validator", () => {
    expect(() => validate({ status: "published" }, updateCertificateSchema)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});
