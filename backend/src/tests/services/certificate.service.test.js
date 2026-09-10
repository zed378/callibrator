/**
 * Tests for certificate.service.js
 */

const mockStatus = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  SIGNED: "signed",
  REVOKED: "revoked",
};

jest.mock("../../config");

jest.mock("sequelize", () => {
  const mockSequelize = jest.fn();
  mockSequelize.useCLS = jest.fn();
  return {
    Sequelize: mockSequelize,
    Op: {
      in: Symbol("in"),
      like: Symbol("like"),
      gte: Symbol("gte"),
      lte: Symbol("lte"),
    },
    fn: jest.fn(),
    col: jest.fn(),
  };
});

jest.mock("../../models", () => ({
  Certificate: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    findAll: jest.fn(),
    generateCertificateNumber: jest.fn(),
    countByStatus: jest.fn(),
    STATUS: mockStatus,
  },
  CalibrationDevice: {
    findOne: jest.fn(),
  },
  Tenant: {
    findByPk: jest.fn(),
  },
  ESignatureRecord: {
    create: jest.fn().mockResolvedValue({}),
  },
  User: {
    findByPk: jest.fn(),
  },
}));

// Real signature: passIsValid(userId, password) -> { success, status, message, data: { valid } }
jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn().mockResolvedValue({ data: { valid: true } }),
}));

// mfa.service exports a MfaService instance; verifyLogin(user, token) is
// synchronous and returns a boolean.
jest.mock("../../services/mfa.service", () => ({
  verifyLogin: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../validators/certificate.validator", () => ({
  validate: jest.fn(),
  createCertificateSchema: "createCertificateSchema",
  updateCertificateSchema: "updateCertificateSchema",
}));

const { Certificate, CalibrationDevice, Tenant, ESignatureRecord, User } = require("../../models");
const authService = require("../../services/auth.service");
const mfaService = require("../../services/mfa.service");
const validator = require("../../validators/certificate.validator");
const {
  fetchCertificates,
  fetchSpecificCertificate,
  createCertificate,
  updateCertificate,
  deleteCertificate,
  approveCertificate,
  submitCertificateForApproval,
  signCertificate,
  revokeCertificate,
  getCertificateStats,
} = require("../../services/certificate.service");

describe("certificate.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchCertificates", () => {
    it("should fetch certificates successfully without options", async () => {
      Certificate.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "cert-1" }],
        count: 1,
      });

      const result = await fetchCertificates({ tenantId: "tenant-1" });

      expect(result.success).toBe(true);
      expect(result.data.rows).toHaveLength(1);
    });

    it("should fetch certificates with options (deviceId, status, type, certNum, date limits, sorting)", async () => {
      Certificate.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "cert-1" }],
        count: 1,
      });

      const result = await fetchCertificates({
        tenantId: "tenant-1",
        deviceId: "dev-1",
        status: ["draft"],
        type: ["calibration"],
        certificateNumber: "123",
        from: "2026-06-01",
        to: "2026-06-30",
        sortBy: "certificate_number",
        sortOrder: "ASC",
        page: 2,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(Certificate.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            deviceId: "dev-1",
            status: expect.any(Object),
            type: expect.any(Object),
            certificateNumber: expect.any(Object),
            issuedAt: expect.any(Object),
          }),
          order: [["certificateNumber", "ASC"]],
          limit: 10,
          offset: 10,
        }),
      );
    });

    it("applies only a lower bound when `from` is given without `to`", async () => {
      const { Op } = require("sequelize");
      Certificate.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCertificates({ tenantId: "tenant-1", from: "2026-01-01" });

      const where = Certificate.findAndCountAll.mock.calls[0][0].where;
      expect(where.issuedAt[Op.gte]).toBe("2026-01-01");
      expect(where.issuedAt[Op.lte]).toBeUndefined();
    });

    it("applies only an upper bound when `to` is given without `from`", async () => {
      const { Op } = require("sequelize");
      Certificate.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCertificates({ tenantId: "tenant-1", to: "2026-06-30" });

      const where = Certificate.findAndCountAll.mock.calls[0][0].where;
      expect(where.issuedAt[Op.lte]).toBe("2026-06-30");
      expect(where.issuedAt[Op.gte]).toBeUndefined();
    });

    it("ignores empty status and type arrays", async () => {
      Certificate.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCertificates({ tenantId: "tenant-1", status: [], type: [] });

      const where = Certificate.findAndCountAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("status");
      expect(where).not.toHaveProperty("type");
    });

    it("ignores non-array status and type filters", async () => {
      Certificate.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCertificates({ tenantId: "tenant-1", status: "draft", type: "calibration" });

      const where = Certificate.findAndCountAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("status");
      expect(where).not.toHaveProperty("type");
    });

    it("falls back to createdAt DESC for an unrecognised sortBy/sortOrder", async () => {
      Certificate.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCertificates({
        tenantId: "tenant-1",
        sortBy: "not_a_column",
        sortOrder: "sideways",
      });

      expect(Certificate.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ order: [["createdAt", "DESC"]] }),
      );
    });

    it("should handle error during fetching", async () => {
      Certificate.findAndCountAll.mockRejectedValueOnce(new Error("Db error"));
      await expect(fetchCertificates({ tenantId: "tenant-1" })).rejects.toThrow("Db error");
    });
  });

  describe("fetchSpecificCertificate", () => {
    it("should fetch specific certificate successfully", async () => {
      Certificate.findOne.mockResolvedValueOnce({ id: "cert-1" });

      const result = await fetchSpecificCertificate("tenant-1", "cert-1");

      expect(result.success).toBe(true);
      expect(result.data.id).toBe("cert-1");
    });

    it("should return 404 if not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await fetchSpecificCertificate("tenant-1", "cert-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should handle error during specific fetching", async () => {
      Certificate.findOne.mockRejectedValueOnce(new Error("Db error"));
      await expect(fetchSpecificCertificate("tenant-1", "cert-1")).rejects.toThrow("Db error");
    });
  });

  describe("createCertificate", () => {
    it("should return 404 if device is not found or belongs to another tenant", async () => {
      validator.validate.mockReturnValueOnce({ deviceId: "dev-1" });
      CalibrationDevice.findOne.mockResolvedValueOnce(null);

      const result = await createCertificate("tenant-1", "user-1", { deviceId: "dev-1" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should create certificate successfully", async () => {
      validator.validate.mockReturnValueOnce({ deviceId: "dev-1", type: "calibration" });
      CalibrationDevice.findOne.mockResolvedValueOnce({ id: "dev-1" });
      Tenant.findByPk.mockResolvedValueOnce({ code: "TEN" });
      Certificate.generateCertificateNumber.mockResolvedValueOnce("TEN-CERT-001");
      Certificate.create.mockResolvedValueOnce({
        id: "cert-1",
        certificateNumber: "TEN-CERT-001",
      });

      const result = await createCertificate("tenant-1", "user-1", { deviceId: "dev-1" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(result.data.id).toBe("cert-1");
    });

    it.each([
      ["the tenant cannot be loaded", null],
      ["the tenant has no code", {}],
    ])("falls back to the 'T' certificate-number prefix when %s", async (_case, tenant) => {
      validator.validate.mockReturnValueOnce({ deviceId: "dev-1" });
      CalibrationDevice.findOne.mockResolvedValueOnce({ id: "dev-1" });
      Tenant.findByPk.mockResolvedValueOnce(tenant);
      Certificate.generateCertificateNumber.mockResolvedValueOnce("T-CERT-001");
      Certificate.create.mockResolvedValueOnce({ id: "cert-1" });

      const result = await createCertificate("tenant-1", "user-1", { deviceId: "dev-1" });

      expect(Certificate.generateCertificateNumber).toHaveBeenCalledWith(
        "T",
        expect.any(Object),
      );
      expect(result.status).toBe(201);
    });

    it("should handle error during creation", async () => {
      validator.validate.mockReturnValueOnce({ deviceId: "dev-1" });
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        createCertificate("tenant-1", "user-1", { deviceId: "dev-1" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("updateCertificate", () => {
    it("should return 404 if certificate is not found", async () => {
      validator.validate.mockReturnValueOnce({ summary: "New summary" });
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await updateCertificate("tenant-1", "cert-1", { summary: "New summary" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should return 400 if certificate status is SIGNED or REVOKED", async () => {
      validator.validate.mockReturnValueOnce({ summary: "New summary" });
      Certificate.findOne.mockResolvedValueOnce({
        id: "cert-1",
        status: "signed",
      });

      const result = await updateCertificate("tenant-1", "cert-1", { summary: "New summary" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.message).toContain("Cannot update");
    });

    it("should update certificate successfully", async () => {
      validator.validate.mockReturnValueOnce({ summary: "New summary" });
      const mockCert = {
        id: "cert-1",
        status: "draft",
        update: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await updateCertificate("tenant-1", "cert-1", {
        summary: "New summary",
        updatedBy: "user-2",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockCert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: "New summary",
          updatedBy: "user-2",
        }),
      );
    });

    it("should null out updatedBy when the caller does not supply it", async () => {
      validator.validate.mockReturnValueOnce({ summary: "New summary" });
      const mockCert = {
        id: "cert-1",
        status: "draft",
        update: jest.fn().mockResolvedValue(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      await updateCertificate("tenant-1", "cert-1", { summary: "New summary" });

      expect(mockCert.update).toHaveBeenCalledWith({
        summary: "New summary",
        updatedBy: null,
      });
    });

    it("should return 400 for a revoked certificate", async () => {
      validator.validate.mockReturnValueOnce({ summary: "New summary" });
      Certificate.findOne.mockResolvedValueOnce({ id: "cert-1", status: "revoked" });

      const result = await updateCertificate("tenant-1", "cert-1", { summary: "New summary" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.message).toBe("Cannot update revoked certificate");
    });

    it("should handle error during update", async () => {
      validator.validate.mockReturnValueOnce({ summary: "New summary" });
      Certificate.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        updateCertificate("tenant-1", "cert-1", { summary: "New summary" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("deleteCertificate", () => {
    it("should return 404 if certificate is not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await deleteCertificate("tenant-1", "cert-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should return 400 if certificate is signed", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "cert-1",
        status: "signed",
      });

      const result = await deleteCertificate("tenant-1", "cert-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.message).toContain("Cannot delete signed certificate");
    });

    it("should delete certificate successfully", async () => {
      const mockCert = {
        id: "cert-1",
        status: "draft",
        destroy: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await deleteCertificate("tenant-1", "cert-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockCert.destroy).toHaveBeenCalled();
    });

    it("should handle error during delete", async () => {
      Certificate.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(deleteCertificate("tenant-1", "cert-1")).rejects.toThrow("Db error");
    });
  });

  describe("approveCertificate", () => {
    it("should return 404 if not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await approveCertificate("tenant-1", "cert-1", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Approved" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should approve certificate successfully", async () => {
      const mockCert = {
        id: "cert-1",
        certificateNumber: "C1",
        status: "pending_approval",
        approve: jest.fn().mockResolvedValueOnce(true),
        save: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await approveCertificate("tenant-1", "cert-1", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Approved" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockCert.approve).toHaveBeenCalled();
      expect(mockCert.approvedBy).toBe("user-2");
      expect(mockCert.save).toHaveBeenCalled();
    });

    it("should handle error during approval", async () => {
      Certificate.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(approveCertificate("tenant-1", "cert-1", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Approved" })).rejects.toThrow("Db error");
    });

    // 21 CFR Part 11: the signature must GATE the act. This previously
    // mutated and saved the certificate first and only then re-authenticated,
    // so a wrong password returned 401 while leaving the certificate approved
    // in the database with no ESignatureRecord written.
    it("must NOT mutate the certificate when re-authentication fails", async () => {
      const mockCert = {
        id: "cert-1",
        certificateNumber: "C1",
        status: "pending_approval",
        approve: jest.fn(),
        save: jest.fn(),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);
      authService.passIsValid.mockResolvedValueOnce({ data: { valid: false } });

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "password",
          authPayload: "wrong-password",
          meaning: "Approved",
        }),
      ).rejects.toMatchObject({ status: 401 });

      expect(mockCert.approve).not.toHaveBeenCalled();
      expect(mockCert.save).not.toHaveBeenCalled();
      expect(mockCert.approvedBy).toBeUndefined();
      expect(ESignatureRecord.create).not.toHaveBeenCalled();
    });

    it("must NOT mutate the certificate when the e-signature payload is incomplete", async () => {
      const mockCert = {
        id: "cert-1",
        status: "pending_approval",
        approve: jest.fn(),
        save: jest.fn(),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      await expect(
        // `meaning` omitted.
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "password",
          authPayload: "correct-password",
        }),
      ).rejects.toMatchObject({ status: 400 });

      expect(mockCert.approve).not.toHaveBeenCalled();
      expect(mockCert.save).not.toHaveBeenCalled();
    });

    it("should write the compliance record only after a successful approval", async () => {
      const mockCert = {
        id: "cert-1",
        certificateNumber: "C1",
        status: "pending_approval",
        approve: jest.fn().mockResolvedValueOnce(true),
        save: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      await approveCertificate("tenant-1", "cert-1", "user-2", {
        authMethod: "password",
        authPayload: "correct-password",
        meaning: "Reviewed and approved",
      });

      expect(ESignatureRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "Certificate",
          entityId: "cert-1",
          userId: "user-2",
          action: "approve",
          meaning: "Reviewed and approved",
          authMethod: "password",
          documentHash: expect.any(String),
        }),
      );
    });

    it("should throw 409 if status is not pending_approval", async () => {
      const mockCert = {
        id: "cert-1",
        status: "draft",
        approve: jest.fn(),
        save: jest.fn(),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "password",
          authPayload: "correct-password",
          meaning: "Approved",
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("submitCertificateForApproval", () => {
    it("should submit a draft certificate for approval successfully", async () => {
      const mockCert = {
        id: "cert-1",
        certificateNumber: "C1",
        status: "draft",
        submitForApproval: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await submitCertificateForApproval("tenant-1", "cert-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockCert.submitForApproval).toHaveBeenCalled();
    });

    it("should return 404 if certificate not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await submitCertificateForApproval("tenant-1", "cert-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should throw 409 if certificate is not in draft status", async () => {
      const mockCert = {
        id: "cert-1",
        status: "approved",
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      await expect(
        submitCertificateForApproval("tenant-1", "cert-1"),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("signCertificate", () => {
    it("should return 404 if not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await signCertificate("tenant-1", "cert-1", "sig", "k1", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Signed" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should sign certificate successfully", async () => {
      const mockCert = {
        id: "cert-1",
        certificateNumber: "C1",
        sign: jest.fn().mockResolvedValueOnce(true),
        save: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await signCertificate("tenant-1", "cert-1", "sig", "k1", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Signed" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockCert.sign).toHaveBeenCalledWith("sig", "k1");
      expect(mockCert.signedBy).toBe("user-2");
    });

    it("should handle error during signing", async () => {
      Certificate.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        signCertificate("tenant-1", "cert-1", "sig", "k1", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Signed" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("revokeCertificate", () => {
    it("should return 404 if not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await revokeCertificate("tenant-1", "cert-1", "reason", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Revoked" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should revoke certificate successfully", async () => {
      const mockCert = {
        id: "cert-1",
        certificateNumber: "C1",
        revoke: jest.fn().mockResolvedValueOnce(true),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await revokeCertificate("tenant-1", "cert-1", "reason", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Revoked" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockCert.revoke).toHaveBeenCalledWith("reason");
    });

    it("should handle error during revocation", async () => {
      Certificate.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        revokeCertificate("tenant-1", "cert-1", "reason", "user-2", { authMethod: "password", authPayload: "correct-password", meaning: "Revoked" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("getCertificateStats", () => {
    it("should fetch statistics successfully", async () => {
      Certificate.count.mockResolvedValueOnce(10);
      Certificate.countByStatus.mockResolvedValueOnce({ approved: 5, signed: 5 });
      Certificate.findAll.mockResolvedValueOnce([
        { type: "calibration", count: "8" },
        { type: "maintenance", count: "2" },
      ]);
      Certificate.findOne.mockResolvedValueOnce({
        id: "cert-latest",
        issuedAt: new Date(),
        device: { name: "Dev 1" },
      });

      const result = await getCertificateStats("tenant-1");

      expect(result.success).toBe(true);
      expect(result.data.totalCertificates).toBe(10);
      expect(result.data.byStatus).toEqual({ approved: 5, signed: 5 });
      expect(result.data.byType).toEqual({ calibration: 8, maintenance: 2 });
    });

    it("should handle error during stats fetching", async () => {
      Certificate.count.mockRejectedValueOnce(new Error("Db error"));
      await expect(getCertificateStats("tenant-1")).rejects.toThrow("Db error");
    });
  });

  // ================================================================
  // 21 CFR Part 11 e-signature gate (authMethod + authPayload + meaning)
  // ================================================================
  describe("e-signature verification", () => {
    const approvableCert = () => ({
      id: "cert-1",
      certificateNumber: "C1",
      deviceId: "dev-1",
      calibrationRecordId: "rec-1",
      status: "pending_approval",
      digitalSignature: null,
      approve: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
    });

    it.each([
      ["authMethod", { authPayload: "pw", meaning: "Approved" }],
      ["authPayload", { authMethod: "password", meaning: "Approved" }],
      ["meaning", { authMethod: "password", authPayload: "pw" }],
    ])("rejects with 400 when %s is missing", async (_field, authOptions) => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", authOptions),
      ).rejects.toMatchObject({
        status: 400,
        message: "Missing required E-signature authentication payload.",
      });
      expect(ESignatureRecord.create).not.toHaveBeenCalled();
    });

    it("rejects with 400 when authOptions is omitted entirely", async () => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", undefined),
      ).rejects.toMatchObject({ status: 400 });
      expect(ESignatureRecord.create).not.toHaveBeenCalled();
    });

    it("rejects with 401 when the password re-authentication returns valid:false", async () => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());
      authService.passIsValid.mockResolvedValueOnce({ data: { valid: false } });

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "password",
          authPayload: "wrong-password",
          meaning: "Approved",
        }),
      ).rejects.toMatchObject({
        status: 401,
        message: "Invalid password for e-signature.",
      });
      expect(authService.passIsValid).toHaveBeenCalledWith("user-2", "wrong-password");
      expect(ESignatureRecord.create).not.toHaveBeenCalled();
    });

    it("rejects with 401 when password re-authentication resolves nothing", async () => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());
      authService.passIsValid.mockResolvedValueOnce(null);

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "password",
          authPayload: "pw",
          meaning: "Approved",
        }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("accepts a valid MFA code and logs the signature record", async () => {
      const cert = approvableCert();
      Certificate.findOne.mockResolvedValueOnce(cert);
      User.findByPk.mockResolvedValueOnce({ id: "user-2", mfaEnabled: true, mfaSecret: "s" });
      mfaService.verifyLogin.mockReturnValueOnce(true);

      const result = await approveCertificate("tenant-1", "cert-1", "user-2", {
        authMethod: "mfa",
        authPayload: "123456",
        meaning: "Approved by QA",
        ipAddress: "10.0.0.1",
        userAgent: "jest",
      });

      expect(result.success).toBe(true);
      expect(User.findByPk).toHaveBeenCalledWith("user-2");
      expect(mfaService.verifyLogin).toHaveBeenCalledWith(
        { id: "user-2", mfaEnabled: true, mfaSecret: "s" },
        "123456",
      );
      expect(ESignatureRecord.create).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        entityType: "Certificate",
        entityId: "cert-1",
        userId: "user-2",
        action: "approve",
        meaning: "Approved by QA",
        authMethod: "mfa",
        documentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        ipAddress: "10.0.0.1",
        userAgent: "jest",
      });
    });

    it("rejects with 401 when the MFA code is invalid", async () => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());
      User.findByPk.mockResolvedValueOnce({ id: "user-2", mfaEnabled: true, mfaSecret: "s" });
      mfaService.verifyLogin.mockReturnValueOnce(false);

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "mfa",
          authPayload: "000000",
          meaning: "Approved",
        }),
      ).rejects.toMatchObject({
        status: 401,
        message: "Invalid MFA code for e-signature.",
      });
      expect(ESignatureRecord.create).not.toHaveBeenCalled();
    });

    it("rejects with 400 for an unsupported auth method", async () => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());

      await expect(
        approveCertificate("tenant-1", "cert-1", "user-2", {
          authMethod: "carrier-pigeon",
          authPayload: "coo",
          meaning: "Approved",
        }),
      ).rejects.toMatchObject({ status: 400, message: "Invalid auth method." });
      expect(ESignatureRecord.create).not.toHaveBeenCalled();
    });

    it("defaults ipAddress and userAgent to 'unknown' when not supplied", async () => {
      Certificate.findOne.mockResolvedValueOnce(approvableCert());

      await approveCertificate("tenant-1", "cert-1", "user-2", {
        authMethod: "password",
        authPayload: "pw",
        meaning: "Approved",
      });

      expect(ESignatureRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: "unknown", userAgent: "unknown" }),
      );
    });

    it("logs a 'sign' action for signCertificate", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "cert-1",
        certificateNumber: "C1",
        status: "approved",
        sign: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
      });

      await signCertificate("tenant-1", "cert-1", "sig", "k1", "user-2", {
        authMethod: "password",
        authPayload: "pw",
        meaning: "Signed by approver",
      });

      expect(ESignatureRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "sign", meaning: "Signed by approver" }),
      );
    });

    it("logs a 'revoke' action for revokeCertificate", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "cert-1",
        certificateNumber: "C1",
        status: "signed",
        revoke: jest.fn().mockResolvedValue(true),
      });

      await revokeCertificate("tenant-1", "cert-1", "reason", "user-2", {
        authMethod: "password",
        authPayload: "pw",
        meaning: "Revoked",
      });

      expect(ESignatureRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "revoke", meaning: "Revoked" }),
      );
    });

    it("propagates a 401 from signCertificate when re-authentication fails", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "cert-1",
        certificateNumber: "C1",
        status: "approved",
        sign: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
      });
      authService.passIsValid.mockResolvedValueOnce({ data: { valid: false } });

      await expect(
        signCertificate("tenant-1", "cert-1", "sig", "k1", "user-2", {
          authMethod: "password",
          authPayload: "wrong",
          meaning: "Signed",
        }),
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});
