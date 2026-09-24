/**
 * A-65 — an e-signature must be attributable, intentional and non-repudiable.
 *
 * eSignature.service#signDocument used to:
 *   - never check `step.signerId === userId`, so anyone in the tenant could
 *     complete another signer's pending step;
 *   - "re-authenticate" by checking only that the user was active;
 *   - take the Part 11 ipAddress / userAgent from the request body, using the
 *     connection's values only as a fallback.
 *
 * The service half runs the REAL signing crypto and the REAL credential check
 * (certificate.service#verifySignerCredentials, shared with certificate
 * approval). Only the models, the password comparison and the MFA check are
 * doubled — at the boundary, so a wrong password is wrong for the same reason
 * it would be in production.
 *
 * The controller half runs the REAL route validator middleware and the REAL
 * controller, and asserts what reaches the service.
 */

jest.mock("../../config", () => ({
  db: { transaction: async (cb) => cb("TX") },
}));

const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const TENANT_ID = "tenant-1";
const SIGNER = "u-1";
const PASSWORD = "correct horse battery staple";
const MFA_CODE = "123456";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe("A-65 — eSignature.service#signDocument", () => {
  let keyPair;
  const savedEnv = process.env.REQUIRE_REAUTHENTICATION;

  beforeAll(() => {
    keyPair = generateTestKeyPair({ keyId: "key-a65" });
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.REQUIRE_REAUTHENTICATION;
    } else {
      process.env.REQUIRE_REAUTHENTICATION = savedEnv;
    }
  });

  const buildHarness = ({ stepFields = {}, users = {} } = {}) => {
    const step = {
      id: "step-1",
      status: "pending",
      stepNumber: 1,
      workflowId: "wf-1",
      tenantId: TENANT_ID,
      signerId: SIGNER,
      update: jest.fn().mockResolvedValue(true),
      ...stepFields,
    };
    const workflow = {
      id: "wf-1",
      documentId: "doc-1",
      tenantId: TENANT_ID,
      status: "in_progress",
      update: jest.fn().mockResolvedValue(true),
    };
    const userRows = {
      [SIGNER]: { id: SIGNER, status: "ACTIVE", isActive: true, mfaEnabled: true, mfaSecret: "S" },
      "u-2": { id: "u-2", status: "ACTIVE", isActive: true, mfaEnabled: true, mfaSecret: "S2" },
      ...users,
    };
    const models = {
      TenantKey: {
        unscoped: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(keyPair) })),
        findOne: jest.fn(),
      },
      SignatureWorkflowStep: {
        // The global tenant hook is what makes another tenant's step null here.
        findByPk: jest.fn(async (id) => (id === step.id ? step : null)),
        findAll: jest.fn().mockResolvedValue([{ status: "signed" }]),
      },
      SignatureWorkflow: { findByPk: jest.fn().mockResolvedValue(workflow) },
      SignatureRecord: {
        create: jest.fn(async (attrs) => ({ ...attrs, id: "sig-1" })),
      },
      AuditLog: { create: jest.fn().mockResolvedValue(true) },
      User: {
        findByPk: jest.fn(async (id) => userRows[id] || null),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };

    // The boundary doubles: a password is right only if it IS the password.
    const passIsValid = jest.fn(async (userId, password) => ({
      data: { valid: userId === SIGNER && password === PASSWORD },
    }));
    const verifyLogin = jest.fn((user, code) => code === MFA_CODE);

    jest.resetModules();
    jest.doMock("../../models", () => models);
    jest.doMock("../../middlewares/activityLog.middleware", () => ({ logger: mockLogger }));
    jest.doMock("../../services/auth.service", () => ({ passIsValid }));
    jest.doMock("../../services/mfa.service", () => ({ verifyLogin }));
    const svc = require("../../services/eSignature.service");

    return { svc, step, workflow, models, passIsValid, verifyLogin };
  };

  const expectNothingPersisted = (h) => {
    expect(h.models.SignatureRecord.create).not.toHaveBeenCalled();
    expect(h.step.update).not.toHaveBeenCalled();
    expect(h.workflow.update).not.toHaveBeenCalled();
    expect(h.models.AuditLog.create).not.toHaveBeenCalled();
  };

  describe("signer binding", () => {
    it("a user who is not the step's signer gets 403", async () => {
      const h = buildHarness();

      // u-2 is in the same tenant and holds valid credentials of their own.
      await expect(
        h.svc.signDocument("step-1", "u-2", { authenticationMethod: "mfa", authPayload: MFA_CODE }),
      ).rejects.toMatchObject({ status: 403 });

      expectNothingPersisted(h);
    });

    it("a step with no internal signer cannot be signed by anyone: 403", async () => {
      const h = buildHarness({ stepFields: { signerId: null } });

      await expect(
        h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "password", authPayload: PASSWORD }),
      ).rejects.toMatchObject({ status: 403 });

      expectNothingPersisted(h);
    });

    it("a step that is not in the caller's tenant stays 404, not 403", async () => {
      const h = buildHarness();

      await expect(
        h.svc.signDocument("step-of-another-tenant", "u-2", {
          authenticationMethod: "password",
          authPayload: PASSWORD,
        }),
      ).rejects.toMatchObject({ status: 404 });

      expectNothingPersisted(h);
    });

    it("the signer check does not reveal the step's state to a non-signer", async () => {
      const h = buildHarness({ stepFields: { status: "signed" } });

      await expect(
        h.svc.signDocument("step-1", "u-2", { authenticationMethod: "password", authPayload: PASSWORD }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("re-authentication", () => {
    it("signing requires the signer's password", async () => {
      const h = buildHarness();

      await expect(
        h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "password" }),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "password", authPayload: "wrong" }),
      ).rejects.toMatchObject({ status: 401 });
      expectNothingPersisted(h);

      const signed = await h.svc.signDocument("step-1", SIGNER, {
        authenticationMethod: "password",
        authPayload: PASSWORD,
      });

      expect(signed.signatureId).toBe("sig-1");
      // The credential checked is the CALLER's, never a body-named user's.
      expect(h.passIsValid).toHaveBeenLastCalledWith(SIGNER, PASSWORD);
    });

    it("an MFA code is accepted in place of the password, and checked", async () => {
      const h = buildHarness();

      await expect(
        h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "mfa", authPayload: "000000" }),
      ).rejects.toMatchObject({ status: 401 });
      expectNothingPersisted(h);

      await h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "mfa", authPayload: MFA_CODE });

      expect(h.verifyLogin).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: SIGNER }),
        MFA_CODE,
      );
      expect(h.models.SignatureRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ authenticationMethod: "mfa", userId: SIGNER }),
        { transaction: "TX" },
      );
    });

    it("an MFA signature from an account without MFA is a 400, not a 500", async () => {
      const h = buildHarness({ users: { [SIGNER]: { id: SIGNER, status: "ACTIVE", isActive: true, mfaEnabled: false } } });

      await expect(
        h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "mfa", authPayload: MFA_CODE }),
      ).rejects.toMatchObject({ status: 400 });
      expectNothingPersisted(h);
    });

    it("REQUIRE_REAUTHENTICATION=false no longer switches re-authentication off", async () => {
      process.env.REQUIRE_REAUTHENTICATION = "false";
      const h = buildHarness();

      await expect(
        h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "password", authPayload: "wrong" }),
      ).rejects.toMatchObject({ status: 401 });
      expectNothingPersisted(h);
      expect(h.svc.getStatus().reauthenticationRequired).toBe(true);
    });

    it("the credential never reaches the signature record or the audit row", async () => {
      const h = buildHarness();

      await h.svc.signDocument("step-1", SIGNER, {
        authenticationMethod: "password",
        authPayload: PASSWORD,
      });

      expect(JSON.stringify(h.models.SignatureRecord.create.mock.calls)).not.toContain(PASSWORD);
      expect(JSON.stringify(h.models.AuditLog.create.mock.calls)).not.toContain(PASSWORD);
    });
  });
});

describe("A-65 — POST /esignature/sign (validator + controller)", () => {
  const runRoute = async (body, connection) => {
    jest.resetModules();
    const signDocument = jest.fn().mockResolvedValue({ signatureId: "sig-1" });
    jest.doMock("../../services/eSignature.service", () => ({ signDocument }));
    jest.doMock("../../middlewares/activityLog.middleware", () => ({ logger: mockLogger }));
    const { validate } = require("../../middlewares/validation.middleware");
    const validator = require("../../validators/eSignature.validator");
    const controller = require("../../controllers/eSignature.controller");

    const req = {
      body,
      params: {},
      query: {},
      user: { id: SIGNER, tenantId: TENANT_ID },
      ip: connection.ip,
      get: (h) => (h.toLowerCase() === "user-agent" ? connection.userAgent : undefined),
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    await validate(validator.signDocument)(req, res, async () => {
      await controller.signDocument(req, res, next);
    });
    return { signDocument, res, next };
  };

  const STEP = "4b8e1d2c-9f4e-4c1a-8f3e-2a6b7c8d9e0f";

  it("the IP address and user agent come from the connection only", async () => {
    const { signDocument } = await runRoute(
      {
        stepId: STEP,
        authenticationMethod: "password",
        authPayload: PASSWORD,
        ipAddress: "198.51.100.4",
        userAgent: "Forged/1.0",
      },
      { ip: "203.0.113.9", userAgent: "Mozilla/5.0" },
    );

    expect(signDocument).toHaveBeenCalledWith(
      STEP,
      SIGNER,
      expect.objectContaining({ ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0" }),
    );
  });

  it("a body ip/user agent is not used even when the connection has none", async () => {
    const { signDocument } = await runRoute(
      {
        stepId: STEP,
        authenticationMethod: "password",
        authPayload: PASSWORD,
        ipAddress: "198.51.100.4",
        userAgent: "Forged/1.0",
      },
      { ip: undefined, userAgent: undefined },
    );

    const [, , data] = signDocument.mock.calls[0];
    expect(data.ipAddress).toBeUndefined();
    expect(data.userAgent).toBeUndefined();
  });

  it("the credential and the meaning reach the service", async () => {
    const { signDocument } = await runRoute(
      { stepId: STEP, authenticationMethod: "mfa", authPayload: MFA_CODE, reason: "Reviewed" },
      { ip: "203.0.113.9", userAgent: "Mozilla/5.0" },
    );

    expect(signDocument).toHaveBeenCalledWith(
      STEP,
      SIGNER,
      expect.objectContaining({ authenticationMethod: "mfa", authPayload: MFA_CODE, reason: "Reviewed" }),
    );
  });

  it("a signing request without a credential is a 400 and never reaches the service", async () => {
    const { signDocument, res } = await runRoute(
      { stepId: STEP, authenticationMethod: "password" },
      { ip: "203.0.113.9", userAgent: "Mozilla/5.0" },
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(signDocument).not.toHaveBeenCalled();
  });
});
