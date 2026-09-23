/**
 * eSignature.service — cryptographic signing and verification (ADR-040).
 *
 * These tests exercise the REAL crypto: a real 2048-bit RSA key pair, the real
 * AES-256-CBC key-at-rest wrapper, node's real crypto.sign/crypto.verify. The
 * only mocks are the Sequelize models and the logger.
 *
 * That is deliberate. The defect this file exists to prevent was a signature
 * computed over `Date.now()`, which meant verification could never succeed —
 * and a suite that mocked the signer would have passed anyway.
 *
 * Every test here signs through signDocument() and verifies through
 * verifySignature(); nothing reaches into a private function.
 */

const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const ESIGN_PATH = "../../services/eSignature.service";
const TENANT_ID = "tenant-1";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const loadService = (models) => {
  jest.resetModules();
  jest.doMock("../../models", () => models);
  jest.doMock("../../middlewares/activityLog.middleware", () => ({
    logger: mockLogger,
  }));
  return require(ESIGN_PATH);
};

describe("eSignature.service — RSA signing and verification", () => {
  /** @type {{keyId: string, publicKey: string, privateKey: string}} */
  let keyPair;

  beforeAll(() => {
    keyPair = generateTestKeyPair({ keyId: "key-esign-1" });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Build a model set whose SignatureRecord.create stores the row that
   * findByPk then returns — so a test can sign, optionally tamper with the
   * stored row, and verify, exactly as production would.
   */
  const buildHarness = ({
    signingKeyRow = keyPair,
    verificationKeyRow = { keyId: keyPair.keyId, publicKey: keyPair.publicKey, deletedAt: null },
  } = {}) => {
    const stored = {};
    const workflow = {
      id: "wf-1",
      documentId: "doc-1",
      tenantId: TENANT_ID,
      subject: "Sign me",
      update: jest.fn().mockResolvedValue(true),
    };
    const step = {
      id: "step-1",
      status: "pending",
      stepNumber: 1,
      workflowId: "wf-1",
      tenantId: TENANT_ID,
      update: jest.fn().mockResolvedValue(true),
    };

    const signingFindOne = jest.fn().mockResolvedValue(signingKeyRow);
    const verificationFindOne = jest.fn().mockResolvedValue(verificationKeyRow);

    const models = {
      TenantKey: {
        unscoped: jest.fn(() => ({ findOne: signingFindOne })),
        findOne: verificationFindOne,
      },
      SignatureWorkflowStep: {
        findByPk: jest.fn().mockResolvedValue(step),
        findAll: jest.fn().mockResolvedValue([{ status: "signed" }]),
      },
      SignatureWorkflow: {
        findByPk: jest.fn().mockResolvedValue(workflow),
      },
      SignatureRecord: {
        create: jest.fn(async (attrs) => {
          Object.assign(stored, attrs, { id: "sig-1" });
          return stored;
        }),
        findByPk: jest.fn(async () => (stored.id ? stored : null)),
      },
      AuditLog: { create: jest.fn().mockResolvedValue(true) },
      User: {
        findByPk: jest.fn().mockResolvedValue({ id: "u-1", status: "active" }),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };

    return {
      models,
      stored,
      workflow,
      step,
      signingFindOne,
      verificationFindOne,
      svc: loadService(models),
    };
  };

  const signOnce = async (harness, data = {}) =>
    harness.svc.signDocument("step-1", "u-1", {
      authenticationMethod: "password",
      ipAddress: "10.0.0.9",
      userAgent: "jest",
      ...data,
    });

  // ================================================================
  describe("a genuine signature", () => {
    it("verifies as valid — the case that could never pass before ADR-040", async () => {
      const harness = buildHarness();

      const signed = await signOnce(harness);
      expect(signed.signatureId).toBe("sig-1");

      // What was persisted is what verification will rebuild from.
      expect(harness.stored.signatureScheme).toBe("esig-v2-rsa-sha256");
      expect(harness.stored.signingKeyId).toBe("key-esign-1");
      expect(typeof harness.stored.signatureValue).toBe("string");
      expect(harness.stored.signedAt).toBeInstanceOf(Date);

      const result = await harness.svc.verifySignature("sig-1");

      expect(result.valid).toBe(true);
      expect(result.verificationStatus).toBe("valid");
      expect(result.details).toMatchObject({
        signatureId: "sig-1",
        documentId: "doc-1",
        signerId: "u-1",
        scheme: "esig-v2-rsa-sha256",
        signingKeyId: "key-esign-1",
        signingKeyDeletedAt: null,
      });
    });

    it("binds the signature meaning (21 CFR 11.50) and still verifies", async () => {
      const harness = buildHarness();

      await signOnce(harness, { reason: "Approved by the quality manager" });
      expect(harness.stored.signatureReason).toBe(
        "Approved by the quality manager",
      );

      await expect(harness.svc.verifySignature("sig-1")).resolves.toMatchObject(
        { valid: true, details: { reason: "Approved by the quality manager" } },
      );
    });

    it("verifies when the driver returns signedAt as an ISO string rather than a Date", async () => {
      const harness = buildHarness();

      await signOnce(harness);
      harness.stored.signedAt = harness.stored.signedAt.toISOString();

      const result = await harness.svc.verifySignature("sig-1");
      expect(result.valid).toBe(true);
    });

    it("writes the certificate and the audit row with the key it signed under", async () => {
      const harness = buildHarness();

      const signed = await signOnce(harness);

      expect(signed.certificate).toMatchObject({
        signingKeyId: "key-esign-1",
        signatureScheme: "esig-v2-rsa-sha256",
      });
      expect(harness.models.AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DOCUMENT_SIGNED",
          after: expect.objectContaining({
            signingKeyId: "key-esign-1",
            signatureScheme: "esig-v2-rsa-sha256",
          }),
        }),
      );
    });
  });

  // ================================================================
  describe("a tampered record", () => {
    const expectInvalid = (result) => {
      expect(result.valid).toBe(false);
      expect(result.verificationStatus).toBe("invalid");
      expect(result.reason).toMatch(/does not match the record/);
    };

    it("verifies as INVALID when the document id is changed after signing", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.workflow.documentId = "doc-substituted";

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });

    it("verifies as INVALID when the signer user id is changed after signing", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.stored.userId = "u-someone-else";

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });

    it("verifies as INVALID when the tenant id is changed after signing", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.stored.tenantId = "tenant-2";

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });

    it("verifies as INVALID when the signing timestamp is changed after signing", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.stored.signedAt = new Date(harness.stored.signedAt.getTime() + 1000);

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });

    it("verifies as INVALID when the authentication method is upgraded after signing", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.stored.authenticationMethod = "biometric";

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });

    it("verifies as INVALID when the signature meaning is rewritten after signing", async () => {
      const harness = buildHarness();
      await signOnce(harness, { reason: "Reviewed" });

      harness.stored.signatureReason = "Approved";

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });

    it("verifies as INVALID when the signature value itself is swapped", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      const forged = Buffer.alloc(256, 7).toString("base64");
      harness.stored.signatureValue = forged;

      expectInvalid(await harness.svc.verifySignature("sig-1"));
    });
  });

  // ================================================================
  describe("key lifecycle", () => {
    it("still verifies a signature whose key has been soft-deleted", async () => {
      const deletedAt = new Date("2026-09-20T00:00:00.000Z");
      const harness = buildHarness({
        verificationKeyRow: {
          keyId: keyPair.keyId,
          publicKey: keyPair.publicKey,
          deletedAt,
        },
      });

      await signOnce(harness);
      const result = await harness.svc.verifySignature("sig-1");

      expect(result.valid).toBe(true);
      expect(result.details.signingKeyDeletedAt).toBe(deletedAt);
      // Load-bearing: without paranoid:false the soft-deleted key is invisible
      // and every past signature silently becomes unverifiable.
      expect(harness.verificationFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ paranoid: false }),
      );
    });

    it("reports a signature whose key is gone as unverifiable, not as a forgery", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.models.TenantKey.findOne.mockResolvedValue(null);
      const result = await harness.svc.verifySignature("sig-1");

      expect(result.valid).toBe(false);
      expect(result.verificationStatus).toBe("unverifiable_key_missing");
      expect(result.reason).toMatch(/no longer present/);
    });

    it("reports a signature whose workflow is gone as unverifiable, not as a forgery", async () => {
      const harness = buildHarness();
      await signOnce(harness);

      harness.models.SignatureWorkflow.findByPk.mockResolvedValue(null);
      const result = await harness.svc.verifySignature("sig-1");

      expect(result.valid).toBe(false);
      expect(result.verificationStatus).toBe("workflow_missing");
      expect(result.details.documentId).toBeNull();
    });
  });

  // ================================================================
  describe("records signed under the old (pre-ADR-040) scheme", () => {
    const legacyRecord = {
      id: "sig-legacy",
      workflowId: "wf-1",
      workflowStepId: "step-1",
      userId: "u-1",
      tenantId: TENANT_ID,
      status: "signed",
      signatureHash: "3f9a…legacy-timestamp-hash",
      signatureValue: null,
      signingKeyId: null,
      signatureScheme: null,
      signatureReason: null,
      signatureAlgorithm: "RS256",
      signedAt: new Date("2026-05-01T10:00:00.000Z"),
      ipAddress: "1.2.3.4",
      userAgent: "legacy",
      authenticationMethod: "password",
      polygon: null,
      biometricData: null,
    };

    it("is reported as unverifiable_legacy — neither valid nor a forgery", async () => {
      const svc = loadService({
        SignatureRecord: { findByPk: jest.fn().mockResolvedValue(legacyRecord) },
        SignatureWorkflow: {
          findByPk: jest.fn().mockResolvedValue({ id: "wf-1", documentId: "doc-1" }),
        },
        TenantKey: { findOne: jest.fn() },
      });

      const result = await svc.verifySignature("sig-legacy");

      expect(result.verificationStatus).toBe("unverifiable_legacy");
      expect(result.verificationStatus).not.toBe("invalid");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/predates the cryptographic signing fix/);
      expect(result.details).toMatchObject({
        signatureId: "sig-legacy",
        scheme: null,
        signingKeyId: null,
        reason: null,
      });
    });

    it("is reported as unverifiable_legacy when the scheme is set but the signature value is empty", async () => {
      const svc = loadService({
        SignatureRecord: {
          findByPk: jest.fn().mockResolvedValue({
            ...legacyRecord,
            signatureScheme: "esig-v2-rsa-sha256",
            signatureValue: "",
          }),
        },
        SignatureWorkflow: {
          findByPk: jest.fn().mockResolvedValue({ id: "wf-1", documentId: "doc-1" }),
        },
        TenantKey: { findOne: jest.fn() },
      });

      const result = await svc.verifySignature("sig-legacy");

      expect(result.verificationStatus).toBe("unverifiable_legacy");
    });
  });

  // ================================================================
  describe("signing without usable key material", () => {
    it("fails with 409 and an actionable message when no key pair is provisioned", async () => {
      const harness = buildHarness({ signingKeyRow: null });

      await expect(signOnce(harness)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining(
          "No e-signature key pair is provisioned for this tenant",
        ),
      });
      // Nothing was written: no half-signed record, no audit row.
      expect(harness.models.SignatureRecord.create).not.toHaveBeenCalled();
      expect(harness.models.AuditLog.create).not.toHaveBeenCalled();
    });

    it("fails with 500 and a named cause when the stored private key cannot be decrypted", async () => {
      const harness = buildHarness({
        signingKeyRow: { keyId: "key-corrupt", privateKey: "notaniv:notciphertext" },
      });

      await expect(signOnce(harness)).rejects.toMatchObject({
        status: 500,
        message: expect.stringContaining("could not be decrypted"),
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Signing key could not be decrypted",
        expect.objectContaining({ keyId: "key-corrupt" }),
      );
    });
  });
});
