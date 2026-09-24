/**
 * Certificate validator tests
 */
const {
  getCertificatesQuery,
  createCertificateSchema,
  updateCertificateSchema,
  certificateIdSchema,
  approveCertificateSchema,
  signCertificateSchema,
  revokeCertificateSchema,
  validate,
  CERTIFICATE_STATUS,
  CERTIFICATE_TYPES,
} = require("../../validators/certificate.validator");

describe("Certificate Validators", () => {
  describe("Enums", () => {
    it("should export CERTIFICATE_STATUS and CERTIFICATE_TYPES", () => {
      expect(CERTIFICATE_STATUS).toContain("draft");
      expect(CERTIFICATE_TYPES).toContain("calibration");
    });
  });

  describe("validate helper", () => {
    it("should throw a validation error when data is invalid", () => {
      const data = {
        deviceId: "invalid-uuid",
      };
      expect(() => {
        validate(data, createCertificateSchema);
      }).toThrow();
    });

    it("should return validated data when correct", () => {
      const data = {
        deviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        type: "calibration",
      };
      const result = validate(data, createCertificateSchema);
      expect(result.deviceId).toBe("8c352a92-d6cf-4b71-b0db-6e69622d1b11");
    });
  });

  describe("getCertificatesQuery schema", () => {
    it("should validate and apply defaults", () => {
      const data = {
        page: "2",
        status: ["draft", "signed"],
        type: ["calibration"],
        from: "2026-06-01T00:00:00Z",
        to: "2026-06-30T23:59:59Z",
      };
      const result = validate(data, getCertificatesQuery);
      expect(result.page).toBe(2);
      expect(result.status).toEqual(["draft", "signed"]);
    });
  });

  describe("updateCertificateSchema", () => {
    it("should validate update data", () => {
      const data = {
        summary: "Updated Summary",
        status: "approved",
      };
      const result = validate(data, updateCertificateSchema);
      expect(result.status).toBe("approved");
    });

    // A-62 — an update cannot name the approver.
    it("strips approvedBy from an update", () => {
      const result = validate(
        { summary: "s", approvedBy: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" },
        updateCertificateSchema,
      );
      expect(result).toEqual({ summary: "s" });
    });
  });

  describe("certificateIdSchema", () => {
    it("should validate uuid", () => {
      const data = {
        certificateId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };
      const result = validate(data, certificateIdSchema);
      expect(result.certificateId).toBe("8c352a92-d6cf-4b71-b0db-6e69622d1b11");
    });
  });

  describe("approveCertificateSchema", () => {
    // A-62 — the approver is the caller; a body approvedBy is stripped, not
    // rejected (a client still sending its own id keeps working).
    it("strips a body approvedBy and keeps the e-signature triple", () => {
      const data = {
        approvedBy: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        authMethod: "password",
        authPayload: "auth-payload",
        meaning: "Approved by supervisor",
      };
      const result = validate(data, approveCertificateSchema);
      expect(result).toEqual({
        authMethod: "password",
        authPayload: "auth-payload",
        meaning: "Approved by supervisor",
      });
      expect(result).not.toHaveProperty("approvedBy");
    });

    it("does not require approvedBy", () => {
      const result = validate(
        { authMethod: "password", authPayload: "p", meaning: "m" },
        approveCertificateSchema,
      );
      expect(result.authMethod).toBe("password");
    });
  });

  describe("signCertificateSchema", () => {
    it("should validate digitalSignature and digitalSignatureKeyId", () => {
      const data = {
        digitalSignature: "sig-data",
        digitalSignatureKeyId: "key-123",
        authMethod: "password",
        authPayload: "auth-payload",
        meaning: "Signed by supervisor",
      };
      const result = validate(data, signCertificateSchema);
      expect(result.digitalSignature).toBe("sig-data");
    });
  });

  describe("revokeCertificateSchema", () => {
    it("should validate reason", () => {
      const data = {
        reason: "Device retired",
        authMethod: "password",
        authPayload: "auth-payload",
        meaning: "Revoked by supervisor",
      };
      const result = validate(data, revokeCertificateSchema);
      expect(result.reason).toBe("Device retired");
    });
  });
});
