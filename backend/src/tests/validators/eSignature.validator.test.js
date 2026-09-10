/**
 * E-Signature validator tests
 */
const {
  createKeyPair,
  createWorkflow,
  signDocument,
  verifySignature,
  revokeSignature,
  validate,
} = require("../../validators/eSignature.validator");

describe("E-Signature Validators", () => {
  describe("createKeyPair", () => {
    it("should validate with default values", () => {
      const value = validate({}, createKeyPair);

      expect(value.algorithm).toBe("RSA");
      expect(value.keySize).toBe(2048);
    });

    it("should validate with explicit RSA", () => {
      expect(() =>
        validate({ algorithm: "RSA", keySize: 4096 }, createKeyPair),
      ).not.toThrow();
    });

    it("should validate with ECDSA", () => {
      expect(() =>
        validate({ algorithm: "ECDSA" }, createKeyPair),
      ).not.toThrow();
    });

    it("should validate with Ed25519", () => {
      expect(() =>
        validate({ algorithm: "Ed25519" }, createKeyPair),
      ).not.toThrow();
    });

    it("should validate with label", () => {
      expect(() =>
        validate({ label: "My Signature Key" }, createKeyPair),
      ).not.toThrow();
    });

    it("should reject invalid algorithm", () => {
      expect(() =>
        validate({ algorithm: "DSA" }, createKeyPair),
      ).toThrow();
    });

    it("should reject invalid key size", () => {
      expect(() =>
        validate({ keySize: 1024 }, createKeyPair),
      ).toThrow();
    });
  });

  describe("createWorkflow", () => {
    it("should validate correct workflow data", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "signer@example.com",
                name: "John Doe",
              },
            ],
            subject: "Please sign this document",
          },
          createWorkflow,
        ),
      ).not.toThrow();
    });

    it("should validate with multiple signers", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "signer1@example.com",
                name: "John Doe",
              },
              {
                userId: "user-2",
                email: "signer2@example.com",
                name: "Jane Smith",
              },
            ],
            subject: "Please sign this document",
          },
          createWorkflow,
        ),
      ).not.toThrow();
    });

    it("should validate with message", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "signer@example.com",
                name: "John Doe",
              },
            ],
            subject: "Please sign",
            message: "Kindly review and sign.",
          },
          createWorkflow,
        ),
      ).not.toThrow();
    });

    it("should validate with empty message", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "signer@example.com",
                name: "John Doe",
              },
            ],
            subject: "Please sign",
            message: "",
          },
          createWorkflow,
        ),
      ).not.toThrow();
    });

    it("should validate with expiresAt", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "signer@example.com",
                name: "John Doe",
              },
            ],
            subject: "Please sign",
            expiresAt: "2026-12-31",
          },
          createWorkflow,
        ),
      ).not.toThrow();
    });

    it("should reject missing document ID", () => {
      expect(() =>
        validate(
          {
            signers: [
              {
                userId: "user-1",
                email: "signer@example.com",
                name: "John Doe",
              },
            ],
            subject: "Please sign",
          },
          createWorkflow,
        ),
      ).toThrow();
    });

    it("should reject missing signers", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            subject: "Please sign",
          },
          createWorkflow,
        ),
      ).toThrow();
    });

    it("should reject empty signers array", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [],
            subject: "Please sign",
          },
          createWorkflow,
        ),
      ).toThrow();
    });

    it("should reject signer missing email", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                name: "John Doe",
              },
            ],
            subject: "Please sign",
          },
          createWorkflow,
        ),
      ).toThrow();
    });

    it("should reject invalid email", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "not-an-email",
                name: "John Doe",
              },
            ],
            subject: "Please sign",
          },
          createWorkflow,
        ),
      ).toThrow();
    });

    it("should reject missing subject", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: "user-1",
                email: "signer@example.com",
                name: "John Doe",
              },
            ],
          },
          createWorkflow,
        ),
      ).toThrow();
    });
  });

  describe("signDocument", () => {
    // stepId identifies the workflow step being signed. It lives in the body
    // because POST /sign has no path param — the controller used to read
    // req.params.stepId, which was always undefined.
    const STEP_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    it("should validate with default authentication method", () => {
      const value = validate({ stepId: STEP_ID }, signDocument);

      expect(value.authenticationMethod).toBe("password");
      expect(value.stepId).toBe(STEP_ID);
    });

    it("should reject a missing stepId", () => {
      expect(() => validate({}, signDocument)).toThrow();
    });

    it("should reject a stepId that is not a uuid", () => {
      expect(() => validate({ stepId: "not-a-uuid" }, signDocument)).toThrow();
    });

    it("should validate with password method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "password" }, signDocument),
      ).not.toThrow();
    });

    it("should validate with mfa method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "mfa" }, signDocument),
      ).not.toThrow();
    });

    it("should validate with webauthn method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "webauthn" }, signDocument),
      ).not.toThrow();
    });

    it("should validate with totp method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "totp" }, signDocument),
      ).not.toThrow();
    });

    it("should validate with polygon data", () => {
      expect(() =>
        validate(
          { stepId: STEP_ID, polygon: { x: 10, y: 20, width: 100, height: 50 } },
          signDocument,
        ),
      ).not.toThrow();
    });

    it("should validate with null polygon", () => {
      expect(() =>
        validate({ stepId: STEP_ID, polygon: null }, signDocument),
      ).not.toThrow();
    });

    it("should validate with biometric data", () => {
      expect(() =>
        validate({ stepId: STEP_ID, biometricData: "abc123" }, signDocument),
      ).not.toThrow();
    });

    it("should validate with all fields", () => {
      expect(() =>
        validate(
          {
            stepId: STEP_ID,
            polygon: { x: 10, y: 20 },
            biometricData: "xyz",
            authenticationMethod: "mfa",
            ipAddress: "192.168.1.1",
            userAgent: "Mozilla/5.0",
          },
          signDocument,
        ),
      ).not.toThrow();
    });

    it("should reject invalid authentication method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "sms" }, signDocument),
      ).toThrow();
    });
  });

  describe("verifySignature", () => {
    const SIGNATURE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

    it("should validate a uuid signatureId", () => {
      const value = validate({ signatureId: SIGNATURE_ID }, verifySignature);

      expect(value.signatureId).toBe(SIGNATURE_ID);
    });

    it("should reject a missing signatureId", () => {
      expect(() => validate({}, verifySignature)).toThrow();
    });

    it("should reject a signatureId that is not a uuid", () => {
      expect(() =>
        validate({ signatureId: "nope" }, verifySignature),
      ).toThrow();
    });
  });

  describe("revokeSignature", () => {
    it("should validate with reason", () => {
      expect(() =>
        validate({ reason: "Signature was obtained under duress" }, revokeSignature),
      ).not.toThrow();
    });

    it("should reject missing reason", () => {
      expect(() =>
        validate({}, revokeSignature),
      ).toThrow();
    });

    it("should reject empty reason", () => {
      expect(() =>
        validate({ reason: "" }, revokeSignature),
      ).toThrow();
    });

    it("should reject reason exceeding max length", () => {
      expect(() =>
        validate({ reason: "a".repeat(501) }, revokeSignature),
      ).toThrow();
    });
  });
});
