/**
 * Certificate validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `validateInput` helper, which throws the same plain 400 object the file's
 * own `validate` threw.
 */
const { validateInput } = require("../../validators/input");
const {
  getCertificatesQuery,
  createCertificateSchema,
  updateCertificateSchema,
  certificateIdSchema,
  approveCertificateSchema,
  signCertificateSchema,
  revokeCertificateSchema,
  CERTIFICATE_STATUS,
  CERTIFICATE_TYPES,
} = require("../../validators/certificate.validator");

const ID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

/** @returns what `validateInput` threw, or undefined */
const thrownBy = (data, schema) => {
  try {
    validateInput(data, schema);
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("Certificate Validators", () => {
  describe("Enums", () => {
    it("should export CERTIFICATE_STATUS and CERTIFICATE_TYPES", () => {
      expect(CERTIFICATE_STATUS).toContain("draft");
      expect(CERTIFICATE_TYPES).toContain("calibration");
    });
  });

  describe("validateInput", () => {
    it("should throw a validation error when data is invalid", () => {
      expect(thrownBy({ deviceId: "invalid-uuid" }, createCertificateSchema)).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "deviceId", message: "Invalid GUID" }],
      });
    });

    it("should return validated data when correct", () => {
      const result = validateInput({ deviceId: ID, type: "calibration" }, createCertificateSchema);
      expect(result).toEqual({ deviceId: ID, type: "calibration" });
    });

    it("defaults the type to calibration and converts validUntil to a Date", () => {
      const result = validateInput({ deviceId: ID, validUntil: "2027-01-01" }, createCertificateSchema);
      expect(result).toEqual({ deviceId: ID, type: "calibration", validUntil: new Date("2027-01-01") });
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
      const result = validateInput(data, getCertificatesQuery);
      expect(result.page).toBe(2);
      expect(result.status).toEqual(["draft", "signed"]);
      expect(result.from).toBe("2026-06-01T00:00:00.000Z");
      expect(result.sortBy).toBe("created_at");
      expect(result.sortOrder).toBe("DESC");
    });

    it("refuses a status that is not an array of known statuses", () => {
      expect(thrownBy({ status: "draft" }, getCertificatesQuery).errors).toEqual([
        { field: "status", message: "Invalid input" },
      ]);
    });
  });

  describe("updateCertificateSchema", () => {
    it("should validate update data", () => {
      const data = {
        summary: "Updated Summary",
        status: "approved",
      };
      const result = validateInput(data, updateCertificateSchema);
      expect(result.status).toBe("approved");
    });

    // A-62 — an update cannot name the approver.
    it("strips approvedBy from an update", () => {
      const result = validateInput({ summary: "s", approvedBy: ID }, updateCertificateSchema);
      expect(result).toEqual({ summary: "s" });
    });
  });

  describe("certificateIdSchema", () => {
    it("should validate uuid", () => {
      const result = validateInput({ certificateId: ID }, certificateIdSchema);
      expect(result.certificateId).toBe(ID);
    });
  });

  describe("approveCertificateSchema", () => {
    // A-62 — the approver is the caller; a body approvedBy is stripped, not
    // rejected (a client still sending its own id keeps working).
    it("strips a body approvedBy and keeps the e-signature triple", () => {
      const data = {
        approvedBy: ID,
        authMethod: "password",
        authPayload: "auth-payload",
        meaning: "Approved by supervisor",
      };
      const result = validateInput(data, approveCertificateSchema);
      expect(result).toEqual({
        authMethod: "password",
        authPayload: "auth-payload",
        meaning: "Approved by supervisor",
      });
      expect(result).not.toHaveProperty("approvedBy");
    });

    it("does not require approvedBy", () => {
      const result = validateInput({ authMethod: "password", authPayload: "p", meaning: "m" }, approveCertificateSchema);
      expect(result.authMethod).toBe("password");
    });

    it("refuses an unknown auth method and an empty payload or meaning", () => {
      expect(thrownBy({ authMethod: "sms", authPayload: "", meaning: "" }, approveCertificateSchema).errors).toEqual([
        { field: "authMethod", message: 'Invalid option: expected one of "password"|"mfa"' },
        { field: "authPayload", message: "Too small: expected string to have >=1 characters" },
        { field: "meaning", message: "Too small: expected string to have >=1 characters" },
      ]);
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
      const result = validateInput(data, signCertificateSchema);
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
      const result = validateInput(data, revokeCertificateSchema);
      expect(result.reason).toBe("Device retired");
    });
  });
});
