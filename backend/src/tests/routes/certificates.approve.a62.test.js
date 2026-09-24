/**
 * A-62 — the approver of a certificate was whoever the request body said.
 *
 * `certificate.controller#approveCertificate` passed `req.body.approvedBy` to
 * the service, which re-authenticated THAT user and stamped THAT id on the
 * certificate, the e-signature record and the audit row. A caller who knew
 * another approver's password could approve in that person's name.
 *
 * These drive the REAL route (routes/api/certificates.route.js): the real
 * validation middleware with the real approveCertificateSchema, the real
 * controller, and the real certificate service. Stubbed:
 *  - `auth` — sets the principal (identity is what is under test here, so the
 *    principal is fixed by the test, not by a token);
 *  - `dynamicAccess` — the permission gate is not what is under test;
 *  - the models and `db`, backed by the auditLedger fixture, which enforces
 *    the real audit_logs ENUM / NOT NULL columns and commits only what a real
 *    transaction would;
 *  - `authService.passIsValid` — a credential store holding a DIFFERENT
 *    password for each user, so "whose password was checked" is observable.
 */
const { createLedger } = require("../fixtures/auditLedger");

const CALLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CERT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PASSWORDS = { [CALLER]: "caller-password", [OTHER]: "other-password" };

const mockRef = { ledger: null, certificate: null, user: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockRef.user;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
// Not under test, and it pulls in the PDF/QR toolchain.
jest.mock("../../controllers/certificatePdf.controller", () => ({
  verifyCertificate: jest.fn(),
  generatePdf: jest.fn(),
  downloadPdf: jest.fn(),
  getQrCode: jest.fn(),
}));

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
  passIsValid: jest.fn(async (userId, password) => ({
    data: { valid: PASSWORDS[userId] !== undefined && PASSWORDS[userId] === password },
  })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));
jest.mock("../../services/workflow.service", () => ({
  startWorkflow: jest.fn(async () => undefined),
}));

const { Sequelize, DataTypes } = jest.requireActual("sequelize");
const RealCertificate = jest.requireActual("../../models/certificate.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
const authService = require("../../services/auth.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const router = require("../../routes/api/certificates.route");

const makeCertificate = () => {
  const cert = {
    id: CERT_ID,
    certificateNumber: "CERT-T-0001",
    deviceId: "dev-1",
    calibrationRecordId: "rec-1",
    status: "pending_approval",
    approvedBy: null,
  };
  cert.save = async (options) =>
    mockRef.ledger.write(
      "certificates",
      { id: cert.id, status: cert.status, approvedBy: cert.approvedBy },
      options,
    );
  // The model's own transition rules, not the test's.
  cert.approve = RealCertificate.prototype.approve;
  return cert;
};

// Express's own router.handle with a minimal req/res pair — supertest is not a
// dependency of this workspace (same harness as workflows.access.a58.test.js).
const post = (url, body) =>
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
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: "POST",
      url,
      originalUrl: "/api/v1/certificates" + url,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.7",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const approve = (body) => post(`/${CERT_ID}/approve`, body);

describe("A-62 — POST /certificates/:id/approve: the approver is the caller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRef.ledger = createLedger({ cls: false });
    mockRef.certificate = makeCertificate();
    mockRef.user = { id: CALLER, tenantId: TENANT };
    jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(logger, "info").mockImplementation(() => logger);
  });

  it("a body approvedBy naming another user has no effect", async () => {
    const res = await approve({
      approvedBy: OTHER,
      authMethod: "password",
      authPayload: PASSWORDS[CALLER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(200);
    expect(mockRef.certificate.approvedBy).toBe(CALLER);
    const committed = mockRef.ledger.committed("certificates");
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((row) => row.approvedBy !== OTHER)).toBe(true);
    expect(JSON.stringify(mockRef.ledger.rows)).not.toContain(OTHER);
  });

  it("re-authentication checks the caller's own credentials", async () => {
    // The caller knows the OTHER user's password and names them in the body.
    // That used to be a valid approval in the other user's name.
    const res = await approve({
      approvedBy: OTHER,
      authMethod: "password",
      authPayload: PASSWORDS[OTHER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(401);
    expect(authService.passIsValid).toHaveBeenCalledTimes(1);
    expect(authService.passIsValid).toHaveBeenCalledWith(CALLER, PASSWORDS[OTHER]);
    // Nothing was approved or signed. The one audit row is the failed
    // attempt itself (A-126, ADR-051 Q-15), naming the CALLER.
    expect(mockRef.certificate.status).toBe("pending_approval");
    expect(mockRef.ledger.committed("certificates")).toEqual([]);
    expect(mockRef.ledger.committed("e_signature_records")).toEqual([]);
    expect(mockRef.ledger.auditRows().map((r) => [r.action, r.userId])).toEqual([
      ["SIGNATURE_AUTH_FAILED", CALLER],
    ]);
  });

  it("the certificate's approver and the audit row's userId are the same id", async () => {
    const res = await approve({
      approvedBy: OTHER,
      authMethod: "password",
      authPayload: PASSWORDS[CALLER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(200);
    // model.approve() saves the status transition first; the service's save
    // that stamps the approver is the final certificate write.
    const certRow = mockRef.ledger.committed("certificates").at(-1);
    const [signature] = mockRef.ledger.committed("e_signature_records");
    const audit = mockRef.ledger.auditRows();

    expect(audit).toHaveLength(1);
    expect(certRow.approvedBy).toBe(CALLER);
    expect(audit[0].userId).toBe(certRow.approvedBy);
    expect(audit[0].changes.after.approvedBy).toBe(CALLER);
    expect(signature.userId).toBe(CALLER);
    expect(audit[0]).toEqual(
      expect.objectContaining({ action: "APPROVE", resourceId: CERT_ID, ipAddress: "10.0.0.7" }),
    );
  });

  it("approves as the caller when the body carries no approvedBy", async () => {
    const res = await approve({
      authMethod: "password",
      authPayload: PASSWORDS[CALLER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(200);
    expect(mockRef.certificate.approvedBy).toBe(CALLER);
    expect(authService.passIsValid).toHaveBeenCalledWith(CALLER, PASSWORDS[CALLER]);
  });

  it("still 400s when the e-signature triple is missing", async () => {
    const res = await approve({ approvedBy: CALLER });

    expect(res.status).toBe(400);
    expect(authService.passIsValid).not.toHaveBeenCalled();
    expect(mockRef.ledger.rows).toEqual([]);
  });
});
