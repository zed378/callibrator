/**
 * E-Signature validator tests
 */
const {
  createKeyPair,
  createWorkflow,
  signDocument,
  verifySignature,
  cancelWorkflow,
  validate,
} = require("../../validators/eSignature.validator");

const SIGNER_1 = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
const SIGNER_2 = "3f2504e0-4f89-41d3-9a0c-0305e82c3312";

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
                userId: SIGNER_1,
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
                userId: SIGNER_1,
                email: "signer1@example.com",
                name: "John Doe",
              },
              {
                userId: SIGNER_2,
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
                userId: SIGNER_1,
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
                userId: SIGNER_1,
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
                userId: SIGNER_1,
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
                userId: SIGNER_1,
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

    // A-129 / F-10 — the signer's name and email come from the user record,
    // so the body's are stripped: not trusted, not required, not rejected.
    it("strips a signer's body name and email (F-10)", () => {
      const value = validate(
        {
          documentId: "doc-123",
          signers: [{ userId: SIGNER_1, email: "forged@example.com", name: "Someone Else" }],
          subject: "Please sign",
        },
        createWorkflow,
      );

      expect(value.signers).toEqual([{ userId: SIGNER_1 }]);
    });

    it("a signer needs no email or name in the body", () => {
      expect(() =>
        validate(
          { documentId: "doc-123", signers: [{ userId: SIGNER_1 }], subject: "Please sign" },
          createWorkflow,
        ),
      ).not.toThrow();
    });

    it("a signer userId must be a uuid (a non-uuid would reach Postgres as a 500)", () => {
      expect(() =>
        validate(
          { documentId: "doc-123", signers: [{ userId: "user-1" }], subject: "Please sign" },
          createWorkflow,
        ),
      ).toThrow();
    });

    // A-86 — an email-only signer passes the schema on purpose, so the service
    // answers it with the explanation (400, "invite them as a user").
    it("an email-only signer reaches the service, which refuses it with its explanation", () => {
      const value = validate(
        { documentId: "doc-123", signers: [{ email: "vendor@example.com" }], subject: "Please sign" },
        createWorkflow,
      );

      expect(value.signers).toEqual([{}]);
    });

    it("should reject missing subject", () => {
      expect(() =>
        validate(
          {
            documentId: "doc-123",
            signers: [
              {
                userId: SIGNER_1,
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

    // A-65 — every signing request carries the signer's credential.
    const PW = "the-signers-password";
    // A-129 — and the meaning of the signature.
    const MEANING = "Reviewed and approved";

    it("should validate with default authentication method", () => {
      const value = validate({ stepId: STEP_ID, authPayload: PW, reason: MEANING }, signDocument);

      expect(value.authenticationMethod).toBe("password");
      expect(value.stepId).toBe(STEP_ID);
      expect(value.authPayload).toBe(PW);
    });

    it("should reject a missing stepId", () => {
      expect(() => validate({ authPayload: PW }, signDocument)).toThrow();
    });

    it("should reject a stepId that is not a uuid", () => {
      expect(() => validate({ stepId: "not-a-uuid", authPayload: PW }, signDocument)).toThrow();
    });

    it("should reject a signing request without a password or MFA code (A-65)", () => {
      expect(() => validate({ stepId: STEP_ID }, signDocument)).toThrow();
      expect(() => validate({ stepId: STEP_ID, authPayload: "" }, signDocument)).toThrow();
    });

    it("should validate with password method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "password", authPayload: PW, reason: MEANING }, signDocument),
      ).not.toThrow();
    });

    it("should validate with mfa method", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authenticationMethod: "mfa", authPayload: "123456", reason: MEANING }, signDocument),
      ).not.toThrow();
    });

    it.each(["webauthn", "totp", "sms"])(
      "should reject %s — only password and MFA can be re-verified at signing (A-65)",
      (method) => {
        expect(() =>
          validate({ stepId: STEP_ID, authenticationMethod: method, authPayload: PW, reason: MEANING }, signDocument),
        ).toThrow();
      },
    );

    it("should validate with polygon data", () => {
      expect(() =>
        validate(
          { stepId: STEP_ID, authPayload: PW, reason: MEANING, polygon: { x: 10, y: 20, width: 100, height: 50 } },
          signDocument,
        ),
      ).not.toThrow();
    });

    it("should validate with null polygon", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authPayload: PW, reason: MEANING, polygon: null }, signDocument),
      ).not.toThrow();
    });

    it("should validate with biometric data", () => {
      expect(() =>
        validate({ stepId: STEP_ID, authPayload: PW, reason: MEANING, biometricData: "abc123" }, signDocument),
      ).not.toThrow();
    });

    it("should accept the meaning of the signature as `reason`, up to the column's 255", () => {
      expect(validate({ stepId: STEP_ID, authPayload: PW, reason: "Reviewed" }, signDocument).reason).toBe(
        "Reviewed",
      );
      expect(() =>
        validate({ stepId: STEP_ID, authPayload: PW, reason: "x".repeat(256) }, signDocument),
      ).toThrow();
    });

    // A-129 (ADR-051 Q-19) — the meaning is mandatory (21 CFR 11.50(a)(3)).
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["blank", "   "],
      ["null", null],
    ])("should reject a %s meaning (A-129)", (_label, reason) => {
      expect(() => validate({ stepId: STEP_ID, authPayload: PW, reason }, signDocument)).toThrow();
    });

    it("trims the meaning", () => {
      expect(validate({ stepId: STEP_ID, authPayload: PW, reason: "  Verified  " }, signDocument).reason).toBe(
        "Verified",
      );
    });

    it("should strip a body ipAddress / userAgent — they come from the connection (A-65)", () => {
      const value = validate(
        {
          stepId: STEP_ID,
          polygon: { x: 10, y: 20 },
          biometricData: "xyz",
          authenticationMethod: "mfa",
          authPayload: "123456",
          reason: MEANING,
          ipAddress: "192.168.1.1",
          userAgent: "Forged/1.0",
        },
        signDocument,
      );

      expect(value).not.toHaveProperty("ipAddress");
      expect(value).not.toHaveProperty("userAgent");
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

  describe("cancelWorkflow (A-130)", () => {
    it("accepts no body, and an optional trimmed reason", () => {
      expect(validate({}, cancelWorkflow)).toEqual({});
      expect(validate({ reason: "  superseded  " }, cancelWorkflow).reason).toBe("superseded");
      expect(() => validate({ reason: "" }, cancelWorkflow)).not.toThrow();
    });

    it("rejects a reason over 500 characters", () => {
      expect(() => validate({ reason: "a".repeat(501) }, cancelWorkflow)).toThrow();
    });

    it("A-09: an absent body validates as {} (the reason is optional)", () => {
      expect(validate(undefined, cancelWorkflow)).toEqual({});
    });
  });
});
