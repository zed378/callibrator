/**
 * A-28 — evidence and controlled documents can be changed by any role.
 *
 * Until 2026-09-23 the routes exercised here carried `auth` and nothing else,
 * and their services checked tenant only: any role could delete calibration
 * evidence, delete the tenant's signing keys (an API key could too — creating
 * a key pair was already `denyApiKey`, deleting one was not), edit an in-flight
 * signing workflow, author AND publish a controlled procedure with no review,
 * and rescore or delete the risk register.
 *
 * These are behaviour tests, not stack-shape tests. They drive the REAL
 * `dynamicAccess` middleware off the real role/menu matrix in roleConstants,
 * and each refusal asserts that the service was never reached — the row is
 * unchanged, not merely "an error came back".
 *
 * The SOP publish cases run the REAL sop.service, so the 409 is produced by
 * the separation-of-duties rule itself and travels out as a 409, not a 500.
 */

// ---- principal injection -------------------------------------------------
// `auth` is the only middleware stubbed: every test sets the principal it wants
// and everything downstream (denyApiKey, dynamicAccess, the controller
// wrapper's API-key deny-by-default) is the real thing.
let currentUser = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = currentUser;
      next();
    },
  };
});

// The permission matrix comes from roleConstants (the seed source of truth),
// keyed by the role id, which these tests set to the role name.
jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));

// Models: only what dynamicAccess and the real sop.service touch.
const mockSopDocument = {
  findOne: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  findAndCountAll: jest.fn(),
};
const mockSopAck = { bulkCreate: jest.fn(), findOne: jest.fn() };
const mockUser = { findAll: jest.fn(), findByPk: jest.fn() };
const mockAuditLog = { create: jest.fn() };
jest.mock("../../models", () => ({
  SopDocument: mockSopDocument,
  SopTrainingAcknowledgment: mockSopAck,
  User: mockUser,
  AuditLog: mockAuditLog,
  Tenants: { findByPk: jest.fn() },
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));

// Services behind the other three routers are stubbed so a refusal can be
// proved by "the service was never called".
jest.mock("../../services/attachment.service", () => ({
  createAttachment: jest.fn(),
  listAttachments: jest.fn(),
  getAttachment: jest.fn(),
  getDownload: jest.fn(),
  generateSignedUrl: jest.fn(),
  getSignedDownload: jest.fn(),
  deleteAttachment: jest.fn(),
}));
jest.mock("../../services/risk.service", () => ({
  createRisk: jest.fn(),
  getRisks: jest.fn(),
  getRiskById: jest.fn(),
  updateRisk: jest.fn(),
  deleteRisk: jest.fn(),
}));
jest.mock("../../services/eSignature.service", () => ({
  getKeyPairs: jest.fn(),
  generateKeyPair: jest.fn(),
  deleteKeyPair: jest.fn(),
  getWorkflows: jest.fn(),
  createSignatureWorkflow: jest.fn(),
  getWorkflow: jest.fn(),
  updateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
  signDocument: jest.fn(),
  verifySignature: jest.fn(),
  getSignatureHistory: jest.fn(),
}));

// Upload plumbing is irrelevant to authorization.
jest.mock("../../utils/upload.util", () => ({
  upload: () => (req, res, next) => next(),
  getUploadUrl: (name) => "/uploads/" + name,
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (req, res, next) => next(),
}));

const RolesService = require("../../services/roles.service");
const attachmentService = require("../../services/attachment.service");
const riskService = require("../../services/risk.service");
const eSignatureService = require("../../services/eSignature.service");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS } = require("../../constants");

const ROUTERS = {
  "/api/v1/attachments": require("../../routes/api/attachments.route"),
  "/api/v1/esignature": require("../../routes/api/eSignature.route"),
  "/api/v1/sop": require("../../routes/api/sop.route"),
  "/api/v1/risks": require("../../routes/api/risk.route"),
};

// supertest is not a dependency of this workspace, so the routers are driven
// through Express's own `router.handle` with a minimal req/res pair. The
// middleware chain, the controllers and the response envelope are all real.
const http = (method, fullUrl, body = {}) =>
  new Promise((resolve) => {
    const prefix = Object.keys(ROUTERS).find((p) => fullUrl.startsWith(p));
    const url = fullUrl.slice(prefix.length) || "/";
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
      method: method.toUpperCase(),
      url,
      originalUrl: fullUrl,
      body,
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    ROUTERS[prefix].handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";

// The matrix exactly as the seed builds it, so a test cannot pass because the
// fixture is friendlier than production.
const matrixFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix = {};
  for (const [slug, permission] of Object.entries(entry.menus)) {
    matrix[slug] = [permission];
  }
  return matrix;
};

const asRole = (roleName, userId = ID) => {
  currentUser = {
    id: userId,
    tenantId: TENANT,
    role: { id: roleName, name: roleName },
  };
};

const asApiKey = () => {
  currentUser = {
    id: ID,
    tenantId: TENANT,
    isApiKey: true,
    apiKeyScopes: ["*"],
    role: { id: "API_KEY", name: "API_KEY" },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = null;
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) =>
    matrixFor(roleId),
  );
});

// =========================================================================
describe("A-28 — DELETE /api/v1/attachments/:id (calibration evidence)", () => {
  it("refuses a USER with 403 and never reaches the service", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("delete", "/api/v1/attachments/" + ID);

    expect(res.status).toBe(403);
    // Refused by the gate, not by a missing route (which the harness reports
    // as 404) — the message is dynamicAccess's own.
    expect(res.body.message).toMatch(/Forbidden: Insufficient permissions/);
    // The row is unchanged: the delete was never attempted.
    expect(attachmentService.deleteAttachment).not.toHaveBeenCalled();
  });

  it("refuses a TECHNICIAN with 403 and never reaches the service", async () => {
    asRole(ROLE_NAMES.TECHNICIAN);

    const res = await http("delete", "/api/v1/attachments/" + ID);

    expect(res.status).toBe(403);
    expect(attachmentService.deleteAttachment).not.toHaveBeenCalled();
  });

  it("lets a CALIBRATOR ADMIN delete, carrying the actor for the audit row", async () => {
    asRole(ROLE_NAMES.CALIBRATOR_ADMIN);
    attachmentService.deleteAttachment.mockResolvedValue({ id: ID });

    const res = await http("delete", "/api/v1/attachments/" + ID);

    expect(res.status).toBe(200);
    expect(attachmentService.deleteAttachment).toHaveBeenCalledWith(
      TENANT,
      ID,
      expect.objectContaining({ userId: ID }),
    );
  });

  it("still lets a TECHNICIAN read and attach evidence", async () => {
    asRole(ROLE_NAMES.TECHNICIAN);
    attachmentService.listAttachments.mockResolvedValue({
      rows: [],
      meta: { total: 0 },
    });

    const res = await http("get", "/api/v1/attachments");

    expect(res.status).toBe(200);
    expect(attachmentService.listAttachments).toHaveBeenCalled();
  });
});

// =========================================================================
describe("A-28 — DELETE /api/v1/esignature/key-pairs/:keyPairId", () => {
  it("refuses an API key — creating a key pair was denyApiKey, deleting one was not", async () => {
    asApiKey();

    const res = await http("delete", "/api/v1/esignature/key-pairs/" + ID);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/API keys cannot access this endpoint/);
    expect(eSignatureService.deleteKeyPair).not.toHaveBeenCalled();
  });

  it("refuses a USER with 403 and never reaches the service", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("delete", "/api/v1/esignature/key-pairs/" + ID);

    expect(res.status).toBe(403);
    expect(eSignatureService.deleteKeyPair).not.toHaveBeenCalled();
  });

  it("lets a HEALTHCARE ADMIN delete a key pair", async () => {
    asRole(ROLE_NAMES.HEALTCARE_ADMIN);
    eSignatureService.deleteKeyPair.mockResolvedValue({ success: true });

    const res = await http("delete", "/api/v1/esignature/key-pairs/" + ID);

    expect(res.status).toBe(200);
    expect(eSignatureService.deleteKeyPair).toHaveBeenCalled();
  });
});

// =========================================================================
describe("A-28 — signature workflow management", () => {
  it("refuses a USER creating a workflow, before validation runs", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("post", "/api/v1/esignature/workflows", {
      documentId: ID,
      signers: [{ userId: OTHER_ID }],
    });

    expect(res.status).toBe(403);
    expect(eSignatureService.createSignatureWorkflow).not.toHaveBeenCalled();
  });

  it("refuses a USER updating an in-flight workflow", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("put", "/api/v1/esignature/workflows/" + ID, {
      subject: "changed",
    });

    expect(res.status).toBe(403);
    expect(eSignatureService.updateWorkflow).not.toHaveBeenCalled();
  });

  it("refuses an API key deleting a workflow", async () => {
    asApiKey();

    const res = await http("delete", "/api/v1/esignature/workflows/" + ID);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/API keys cannot access this endpoint/);
    expect(eSignatureService.deleteWorkflow).not.toHaveBeenCalled();
  });

  it("lets a CALIBRATOR ADMIN delete a draft workflow", async () => {
    asRole(ROLE_NAMES.CALIBRATOR_ADMIN);
    eSignatureService.deleteWorkflow.mockResolvedValue({ success: true });

    const res = await http("delete", "/api/v1/esignature/workflows/" + ID);

    expect(res.status).toBe(200);
    expect(eSignatureService.deleteWorkflow).toHaveBeenCalled();
  });
});

// =========================================================================
describe("A-28 — SOP authoring and release (separation of duties)", () => {
  const draftDoc = (overrides = {}) => ({
    id: ID,
    documentNumber: "SOP-0007",
    version: "1.0",
    authorId: ID,
    status: "DRAFT",
    requiresTraining: false,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  it("refuses a USER authoring an SOP", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("post", "/api/v1/sop", { title: "Unreviewed" });

    expect(res.status).toBe(403);
    expect(mockSopDocument.create).not.toHaveBeenCalled();
  });

  it("refuses a USER publishing an SOP", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("patch", "/api/v1/sop/" + ID + "/publish");

    expect(res.status).toBe(403);
    expect(mockSopDocument.findOne).not.toHaveBeenCalled();
  });

  it("refuses an API key publishing an SOP", async () => {
    asApiKey();

    const res = await http("patch", "/api/v1/sop/" + ID + "/publish");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/API keys cannot access this endpoint/);
    expect(mockSopDocument.findOne).not.toHaveBeenCalled();
  });

  // The publisher IS the author: refused as a 409 state explanation, not a 500.
  it("refuses publication by the SOP's own author with a 409 that explains the state", async () => {
    asRole(ROLE_NAMES.HEALTCARE_ADMIN, ID);
    const doc = draftDoc({ authorId: ID });
    mockSopDocument.findOne.mockResolvedValue(doc);

    const res = await http("patch", "/api/v1/sop/" + ID + "/publish");

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("SOP-0007 was authored by you");
    expect(doc.status).toBe("DRAFT");
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockAuditLog.create).not.toHaveBeenCalled();
  });

  it("lets a second authorised user publish it, and writes the audit row", async () => {
    asRole(ROLE_NAMES.HEALTCARE_ADMIN, OTHER_ID);
    const doc = draftDoc({ authorId: ID });
    mockSopDocument.findOne.mockResolvedValue(doc);

    const res = await http("patch", "/api/v1/sop/" + ID + "/publish");

    expect(res.status).toBe(200);
    expect(doc.status).toBe("PUBLISHED");
    expect(doc.save).toHaveBeenCalledWith({ transaction: "TX" });
    expect(mockAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "APPROVE",
        resourceType: "SopDocument",
        userId: OTHER_ID,
      }),
      { transaction: "TX" },
    );
  });

  it("refuses re-publishing an already published SOP with a 409", async () => {
    asRole(ROLE_NAMES.HEALTCARE_ADMIN, OTHER_ID);
    const doc = draftDoc({ authorId: ID, status: "PUBLISHED" });
    mockSopDocument.findOne.mockResolvedValue(doc);

    const res = await http("patch", "/api/v1/sop/" + ID + "/publish");

    expect(res.status).toBe(409);
    expect(res.body.message).toContain(
      "SOP-0007 is PUBLISHED and cannot be published",
    );
    expect(doc.save).not.toHaveBeenCalled();
  });
});

// =========================================================================
describe("A-28 — risk register", () => {
  it("refuses a TECHNICIAN creating a risk", async () => {
    asRole(ROLE_NAMES.TECHNICIAN);

    const res = await http("post", "/api/v1/risks", { title: "invented" });

    expect(res.status).toBe(403);
    expect(riskService.createRisk).not.toHaveBeenCalled();
  });

  it("refuses an ENGINEERING MANAGER rescoring a risk — it holds read, not write", async () => {
    asRole(ROLE_NAMES.ENGINEERING_MANAGER);

    const res = await http("put", "/api/v1/risks/" + ID, { severity: 1 });

    expect(res.status).toBe(403);
    expect(riskService.updateRisk).not.toHaveBeenCalled();
  });

  it("lets an ENGINEERING MANAGER read the register", async () => {
    asRole(ROLE_NAMES.ENGINEERING_MANAGER);
    riskService.getRisks.mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      totalPages: 0,
    });

    const res = await http("get", "/api/v1/risks");

    expect(res.status).toBe(200);
  });

  it("refuses a USER deleting a risk and never reaches the service", async () => {
    asRole(ROLE_NAMES.USER);

    const res = await http("delete", "/api/v1/risks/" + ID);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Forbidden: Insufficient permissions/);
    expect(riskService.deleteRisk).not.toHaveBeenCalled();
  });

  it("lets a CALIBRATOR ADMIN delete a risk", async () => {
    asRole(ROLE_NAMES.CALIBRATOR_ADMIN);
    riskService.deleteRisk.mockResolvedValue(true);

    const res = await http("delete", "/api/v1/risks/" + ID);

    expect(res.status).toBe(200);
    expect(riskService.deleteRisk).toHaveBeenCalledWith(TENANT, ID);
  });
});
