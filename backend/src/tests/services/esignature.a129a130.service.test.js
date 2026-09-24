/**
 * A-129 / A-130 — eSignature.service rules not reachable through a route
 * test's happy path: the mandatory meaning of a signature (ADR-051 Q-19,
 * 21 CFR 11.50(a)(3)), signing a step of a cancelled workflow, and the edges of
 * signer resolution (a user with no role, a user with no name).
 *
 * Fail-before, against the code as it stood on 2026-09-24:
 *  - signDocument with no `reason` signed and stored NULL as the meaning;
 *  - signDocument on a pending step of a CANCELLED workflow signed it — the
 *    step's own status was the only state checked;
 *  - getEligibleSigners did not exist.
 */

jest.setTimeout(60000);

jest.mock("../../config", () => ({
  db: { transaction: async (cb) => cb("TX") },
}));

const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockMaySign = jest.fn();

const load = (models) => {
  jest.resetModules();
  jest.doMock("../../models", () => ({ AuditLog: { create: jest.fn(async (v) => v) }, ...models }));
  jest.doMock("../../middlewares/activityLog.middleware", () => ({ logger: mockLogger }));
  jest.doMock("../../services/auth.service", () => ({
    passIsValid: jest.fn(async () => ({ data: { valid: true } })),
  }));
  jest.doMock("../../middlewares/dynamicAccess.middleware", () => ({
    principalHasMenuPermission: mockMaySign,
  }));
  return require("../../services/eSignature.service");
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMaySign.mockImplementation(async (principal) =>
    Boolean(principal.role) && ["TECHNICIAN", "SUPERVISOR"].includes(principal.role.name),
  );
});

// ==========================================================================
describe("signDocument — the meaning of the signature is mandatory (A-129)", () => {
  it.each([
    ["missing", {}],
    ["empty", { reason: "" }],
    ["blank", { reason: "   " }],
    ["not a string", { reason: 42 }],
  ])("a %s meaning is 400 before anything is looked up or signed", async (_label, extra) => {
    const models = {
      SignatureWorkflowStep: { findByPk: jest.fn() },
      SignatureRecord: { create: jest.fn() },
    };
    const svc = load(models);

    const err = await svc
      .signDocument("step-1", "u-1", { authPayload: "pw", ...extra })
      .catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.message).toMatch(/^The meaning of the signature is required/);
    expect(models.SignatureWorkflowStep.findByPk).not.toHaveBeenCalled();
    expect(models.SignatureRecord.create).not.toHaveBeenCalled();
  });

  it("the meaning is trimmed before it is bound into the signature", async () => {
    const keyPair = generateTestKeyPair({ keyId: "key-a129" });
    const step = {
      id: "step-1",
      status: "pending",
      workflowId: "wf-1",
      tenantId: "t-1",
      signerId: "u-1",
      update: jest.fn(),
    };
    const models = {
      SignatureWorkflowStep: {
        findByPk: jest.fn().mockResolvedValue(step),
        findAll: jest.fn().mockResolvedValue([{ ...step, status: "signed" }]),
      },
      SignatureWorkflow: {
        findByPk: jest.fn().mockResolvedValue({ id: "wf-1", documentId: "d-1", status: "pending", update: jest.fn() }),
      },
      SignatureRecord: {
        create: jest.fn(async (attrs) => ({ id: "sig-1", ...attrs })),
      },
      TenantKey: { unscoped: () => ({ findOne: jest.fn().mockResolvedValue(keyPair) }) },
      User: {
        findByPk: jest.fn().mockResolvedValue({ id: "u-1", isActive: true, status: "ACTIVE" }),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };
    const svc = load(models);

    await svc.signDocument("step-1", "u-1", { authPayload: "pw", reason: "  Verified  " });

    expect(models.SignatureRecord.create.mock.calls[0][0].signatureReason).toBe("Verified");
  });
});

// ==========================================================================
describe("signDocument — a cancelled workflow cannot be signed (A-130)", () => {
  it("is 409 with the state explanation, and nothing is signed", async () => {
    const models = {
      SignatureWorkflowStep: {
        findByPk: jest.fn().mockResolvedValue({
          id: "step-1",
          status: "pending",
          workflowId: "wf-1",
          tenantId: "t-1",
          signerId: "u-1",
        }),
      },
      SignatureWorkflow: {
        findByPk: jest.fn().mockResolvedValue({ id: "wf-1", status: "cancelled" }),
      },
      SignatureRecord: { create: jest.fn() },
      User: { findByPk: jest.fn().mockResolvedValue({ id: "u-1", isActive: true, status: "ACTIVE" }) },
    };
    const svc = load(models);

    const err = await svc
      .signDocument("step-1", "u-1", { authPayload: "pw", reason: "Approved" })
      .catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toBe(
      'This signature workflow is "cancelled" and cannot be signed: cancellation is final; create a new workflow instead.',
    );
    expect(models.SignatureRecord.create).not.toHaveBeenCalled();
  });
});

// ==========================================================================
describe("createSignatureWorkflow — signer resolution edges (A-129)", () => {
  it("a user with no role cannot sign: 400, and the permission check is asked with no role", async () => {
    const models = {
      User: {
        findOne: jest.fn().mockResolvedValue({
          id: "u-9",
          tenantId: "t-1",
          email: "norole@example.com",
          firstName: "No",
          lastName: "Role",
          isActive: true,
          status: "ACTIVE",
          roleId: null,
        }),
      },
      Role: { findByPk: jest.fn() },
      SignatureWorkflow: { create: jest.fn() },
    };
    const svc = load(models);

    const err = await svc
      .createSignatureWorkflow("t-1", { documentId: "d-1", signers: [{ userId: "u-9" }] }, { userId: "a-1" })
      .catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.message).toMatch(/^Signer 1 \(No Role\) does not hold the e-signature signing permission/);
    expect(models.Role.findByPk).not.toHaveBeenCalled();
    expect(mockMaySign).toHaveBeenCalledWith({ id: "u-9", role: null }, "esignature", "write");
    expect(models.SignatureWorkflow.create).not.toHaveBeenCalled();
  });

  it("a role row that no longer exists is treated as no role", async () => {
    const models = {
      User: {
        findOne: jest.fn().mockResolvedValue({
          id: "u-9",
          email: "x@example.com",
          firstName: "X",
          lastName: "Y",
          isActive: true,
          status: "ACTIVE",
          roleId: "gone",
        }),
      },
      Role: { findByPk: jest.fn().mockResolvedValue(null) },
      SignatureWorkflow: { create: jest.fn() },
    };
    const svc = load(models);

    const err = await svc
      .createSignatureWorkflow("t-1", { documentId: "d-1", signers: [{ userId: "u-9" }] }, { userId: "a-1" })
      .catch((e) => e);

    expect(err.status).toBe(400);
    expect(mockMaySign).toHaveBeenCalledWith({ id: "u-9", role: null }, "esignature", "write");
  });

  it("looks the signer up in the caller's tenant, explicitly, inside the transaction", async () => {
    const models = {
      User: { findOne: jest.fn().mockResolvedValue(null) },
      SignatureWorkflow: { create: jest.fn() },
    };
    const svc = load(models);

    const err = await svc
      .createSignatureWorkflow("t-1", { documentId: "d-1", signers: [{ userId: "u-x" }] }, { userId: "a-1" })
      .catch((e) => e);

    expect(err).toMatchObject({ status: 404, message: "Signer not found" });
    expect(models.User.findOne).toHaveBeenCalledWith({
      where: { id: "u-x", tenantId: "t-1" },
      transaction: "TX",
    });
  });

  it("a null entry in signers is an email-only signer: 400", async () => {
    const svc = load({ User: { findOne: jest.fn() } });

    const err = await svc
      .createSignatureWorkflow("t-1", { documentId: "d-1", signers: [null] }, { userId: "a-1" })
      .catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.message).toMatch(/^Signer 1: Signers must be users of this organisation/);
  });
});

// ==========================================================================
describe("getEligibleSigners (A-129)", () => {
  const user = (id, fields) => ({
    id,
    email: `${id}@example.com`,
    firstName: "",
    lastName: "",
    username: null,
    roleId: "r-tech",
    ...fields,
  });

  it("returns only users who may sign, as { id, name, email }, sorted by name — the name falling back to username, then email", async () => {
    const models = {
      User: {
        findAll: jest.fn().mockResolvedValue([
          user("u-3", { firstName: "Zara", lastName: "Tech" }),
          user("u-1", { username: "bob.tech" }),
          user("u-2", {}),
          user("u-4", { firstName: "Ward", lastName: "User", roleId: "r-user" }),
          user("u-5", { firstName: "No", lastName: "Role", roleId: null }),
        ]),
      },
      Role: {
        findAll: jest.fn().mockResolvedValue([
          { id: "r-tech", name: "TECHNICIAN" },
          { id: "r-user", name: "USER" },
        ]),
      },
    };
    const svc = load(models);

    const rows = await svc.getEligibleSigners("t-1");

    expect(rows).toEqual([
      { id: "u-1", name: "bob.tech", email: "u-1@example.com" },
      { id: "u-2", name: "u-2@example.com", email: "u-2@example.com" },
      { id: "u-3", name: "Zara Tech", email: "u-3@example.com" },
    ]);
    expect(models.User.findAll.mock.calls[0][0].where).toEqual({
      tenantId: "t-1",
      isActive: true,
      status: "ACTIVE",
    });
    expect(models.Role.findAll.mock.calls[0][0].where).toEqual({ id: ["r-tech", "r-user"] });
  });

  it("a tenant with no active users gets [] without a role query", async () => {
    const models = { User: { findAll: jest.fn().mockResolvedValue([]) }, Role: { findAll: jest.fn() } };
    const svc = load(models);

    expect(await svc.getEligibleSigners("t-1")).toEqual([]);
    expect(models.Role.findAll).not.toHaveBeenCalled();
  });
});
