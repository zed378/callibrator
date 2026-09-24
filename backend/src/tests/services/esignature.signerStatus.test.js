/**
 * eSignature.service#signDocument refused EVERY real signer.
 *
 * It checked `user.status !== "active"`. User.status is UPPERCASE — the model
 * default and constants/appConstants.js USER_STATUS are "ACTIVE" — so no row
 * the application ever stores passed, and every workflow signature was a 401
 * "Re-authentication required". Seven test files agreed with the bug because
 * their user fixtures used the same wrong lowercase value.
 *
 * Here the signer is a REAL User instance, built by the real model on an
 * unconnected Sequelize, carrying the model's own defaults — not a fixture
 * that restates a string. Everything else is the A-65 harness: real signing
 * crypto, the credential check doubled at the boundary.
 */

jest.mock("../../config", () => ({
  db: { transaction: async (cb) => cb("TX") },
}));

const { Sequelize, DataTypes } = require("sequelize");
const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const TENANT_ID = "tenant-1";
const SIGNER = "11111111-1111-4111-8111-111111111111";
const PASSWORD = "correct horse battery staple";

/** A user as the model stores it, defaults included. */
const realUser = (overrides = {}) => {
  const User = require("../../models/user.model")(
    new Sequelize({ dialect: "postgres", logging: false }),
    DataTypes,
  );
  return User.build({
    id: SIGNER,
    username: "ada",
    email: "ada@hospital.example.com",
    password: "hash",
    firstName: "Ada",
    lastName: "Lovelace",
    tenantId: TENANT_ID,
    ...overrides,
  });
};

describe("signDocument — the signer's account state", () => {
  let keyPair;

  beforeAll(() => {
    keyPair = generateTestKeyPair({ keyId: "key-status" });
  });

  const buildHarness = (user) => {
    const step = {
      id: "step-1",
      status: "pending",
      stepNumber: 1,
      workflowId: "wf-1",
      tenantId: TENANT_ID,
      signerId: SIGNER,
      update: jest.fn().mockResolvedValue(true),
    };
    const workflow = {
      id: "wf-1",
      documentId: "doc-1",
      tenantId: TENANT_ID,
      status: "in_progress",
      update: jest.fn().mockResolvedValue(true),
    };
    const models = {
      TenantKey: {
        unscoped: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(keyPair) })),
        findOne: jest.fn(),
      },
      SignatureWorkflowStep: {
        findByPk: jest.fn(async (id) => (id === step.id ? step : null)),
        findAll: jest.fn().mockResolvedValue([{ status: "signed" }]),
      },
      SignatureWorkflow: { findByPk: jest.fn().mockResolvedValue(workflow) },
      SignatureRecord: { create: jest.fn(async (attrs) => ({ ...attrs, id: "sig-1" })) },
      AuditLog: { create: jest.fn().mockResolvedValue(true) },
      User: { findByPk: jest.fn(async (id) => (id === SIGNER ? user : null)) },
    };
    const passIsValid = jest.fn(async (userId, password) => ({
      data: { valid: userId === SIGNER && password === PASSWORD },
    }));

    jest.resetModules();
    jest.doMock("../../models", () => models);
    jest.doMock("../../middlewares/activityLog.middleware", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.doMock("../../services/auth.service", () => ({ passIsValid }));
    const svc = require("../../services/eSignature.service");
    return { svc, models, step };
  };

  const sign = (h) =>
    h.svc.signDocument("step-1", SIGNER, { authenticationMethod: "password", authPayload: PASSWORD, reason: "Approved" });

  it("a real ACTIVE user (as stored by the model default) can sign their step", async () => {
    const user = realUser();
    // The model's own defaults — what every stored account carries.
    expect(user.status).toBe("ACTIVE");
    expect(user.isActive).toBe(true);
    const h = buildHarness(user);

    const signed = await sign(h);

    expect(signed.signatureId).toBe("sig-1");
    expect(h.models.SignatureRecord.create).toHaveBeenCalledTimes(1);
    expect(h.step.update).toHaveBeenCalled();
  });

  it.each([
    ["INACTIVE", { status: "INACTIVE" }],
    ["SUSPENDED", { status: "SUSPENDED" }],
    ["erased (GDPR)", { status: "erased" }],
    ["deactivated (isActive false)", { isActive: false }],
  ])("a %s account is refused 401, and nothing is signed", async (_label, overrides) => {
    const h = buildHarness(realUser(overrides));

    await expect(sign(h)).rejects.toMatchObject({ status: 401, message: "Re-authentication required" });
    expect(h.models.SignatureRecord.create).not.toHaveBeenCalled();
    expect(h.step.update).not.toHaveBeenCalled();
  });
});
