/**
 * A-105 and A-106 — e-signature reads, through the REAL controller, service
 * and response.util. Only the models are doubled.
 *
 * A-105: eSignature.service#getWorkflow caught every error and answered
 * `null`, which the controller reported as 404 — a database outage read as
 * "this workflow does not exist". It also scoped by the hooks alone, and put
 * its step `order` inside the include entry, where Sequelize ignores it.
 *
 * A-106: GET /workflows and GET /history wrapped their rows as
 * `data.workflows` / `data.signatures`. The envelope rule (CLAUDE.md) is rows
 * in `data`, pagination/count in a top-level `meta`.
 */

const mockModels = {
  SignatureWorkflow: { findOne: jest.fn(), findAll: jest.fn() },
  SignatureWorkflowStep: { name: "SignatureWorkflowStep" },
  SignatureRecord: { findAll: jest.fn(), findAndCountAll: jest.fn() },
};

jest.mock("../../models", () => mockModels);
jest.mock("../../config", () => ({
  db: { transaction: async (cb) => cb("TX") },
}));

const eSignatureController = require("../../controllers/eSignature.controller");
const { logger } = require("../../middlewares/activityLog.middleware");

const WF_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const makeRes = () => {
  const res = { statusCode: null, body: null, headersSent: false };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    res.headersSent = true;
    return res;
  });
  return res;
};

const makeReq = (overrides = {}) => ({
  user: { id: "user-1", tenantId: "tenant-1" },
  params: {},
  query: {},
  body: {},
  headers: {},
  ...overrides,
});

describe("A-105 — GET /workflows/:workflowId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a database failure is a 500, not a 404", async () => {
    mockModels.SignatureWorkflow.findOne.mockRejectedValueOnce(
      new Error('relation "signature_workflows" does not exist'),
    );
    const res = makeRes();

    await eSignatureController.getWorkflow(makeReq({ params: { workflowId: WF_ID } }), res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ success: false, status: 500, data: null });
  });

  it("scopes the workflow AND its steps by the caller's tenant explicitly", async () => {
    mockModels.SignatureWorkflow.findOne.mockResolvedValueOnce({ id: WF_ID, steps: [] });
    const res = makeRes();

    await eSignatureController.getWorkflow(makeReq({ params: { workflowId: WF_ID } }), res, jest.fn());

    const query = mockModels.SignatureWorkflow.findOne.mock.calls[0][0];
    expect(query.where).toEqual({ id: WF_ID, tenantId: "tenant-1" });
    expect(query.include).toEqual([
      {
        model: mockModels.SignatureWorkflowStep,
        as: "steps",
        where: { tenantId: "tenant-1" },
        required: false,
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { id: WF_ID, steps: [] } });
  });

  it("orders the steps with a top-level order naming the association (an include-level order is ignored)", async () => {
    mockModels.SignatureWorkflow.findOne.mockResolvedValueOnce({ id: WF_ID, steps: [] });

    await eSignatureController.getWorkflow(makeReq({ params: { workflowId: WF_ID } }), makeRes(), jest.fn());

    const query = mockModels.SignatureWorkflow.findOne.mock.calls[0][0];
    expect(query.order).toEqual([
      [{ model: mockModels.SignatureWorkflowStep, as: "steps" }, "stepNumber", "ASC"],
    ]);
    expect(query.include[0]).not.toHaveProperty("order");
  });

  it("a workflow not in the caller's tenant is a 404, success: false", async () => {
    mockModels.SignatureWorkflow.findOne.mockResolvedValueOnce(null);
    const res = makeRes();

    await eSignatureController.getWorkflow(makeReq({ params: { workflowId: WF_ID } }), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, status: 404, message: "Workflow not found" });
  });
});

describe("A-106 — list envelopes: rows in data, count in a top-level meta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /workflows", async () => {
    const rows = [{ id: "wf-1" }, { id: "wf-2" }];
    mockModels.SignatureWorkflow.findAll.mockResolvedValueOnce(rows);
    const res = makeRes();

    await eSignatureController.getWorkflows(makeReq({ query: { status: "pending" } }), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: "Workflows retrieved",
      data: rows,
      meta: { total: 2 },
    });
  });

  it("GET /workflows — an empty list is an empty array, meta.total 0", async () => {
    mockModels.SignatureWorkflow.findAll.mockResolvedValueOnce([]);
    const res = makeRes();

    await eSignatureController.getWorkflows(makeReq(), res, jest.fn());

    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({ total: 0 });
  });

  it("GET /history", async () => {
    const rows = [{ id: "sig-1" }];
    // D-24 (ADR-070): one page, and meta carries the pagination.
    mockModels.SignatureRecord.findAndCountAll.mockResolvedValueOnce({ count: 1, rows });
    const res = makeRes();

    await eSignatureController.getSignatureHistory(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: "Signature history retrieved",
      data: rows,
      meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
    });
  });
});
