jest.mock("../../services/workflow.service", () => ({
  getWorkflows: jest.fn(),
  getWorkflowById: jest.fn(),
  createWorkflow: jest.fn(),
  updateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
  getPendingTasks: jest.fn(),
  submitAction: jest.fn(),
}));

// Mirrors the real success(res, data, meta, message, statusCode) signature.
// The previous version of this file mocked a `successResponse` export that
// response.util.js does not have — which is exactly why the controller's
// broken import went unnoticed while every route 500'd in production.
jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data = null, meta = null, message = "success", statusCode = 200) => {
    res.status(statusCode).json({ success: true, status: statusCode, message, data });
  }),
  error: jest.fn(),
}));

const workflowController = require("../../controllers/workflow.controller");
const workflowService = require("../../services/workflow.service");
const { success } = require("../../utils/response.util");

describe("workflow Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: "user-1", tenantId: "tenant-1" },
      // auth middleware sets both; the controller reads tenantId because
      // req.tenant is null for tenant-less accounts.
      tenantId: "tenant-1",
      tenant: { id: "tenant-1" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it("uses only exports that response.util actually provides", () => {
    // Guards the regression: an undefined import threw at call time.
    const responseUtil = jest.requireActual("../../utils/response.util");
    expect(responseUtil.successResponse).toBeUndefined();
    expect(typeof responseUtil.success).toBe("function");
  });

  describe("getWorkflows", () => {
    it("should return workflows scoped to the request tenant", async () => {
      workflowService.getWorkflows.mockResolvedValue([{ id: "wf-1" }]);

      await workflowController.getWorkflows(req, res, next);

      expect(workflowService.getWorkflows).toHaveBeenCalledWith("tenant-1");
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: "wf-1" }],
        null,
        "Workflows retrieved successfully",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      workflowService.getWorkflows.mockRejectedValue(new Error("err"));
      await workflowController.getWorkflows(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("getWorkflowById", () => {
    it("should return workflow by id", async () => {
      workflowService.getWorkflowById.mockResolvedValue({ id: "wf-1" });
      req.params = { id: "wf-1" };

      await workflowController.getWorkflowById(req, res, next);

      expect(workflowService.getWorkflowById).toHaveBeenCalledWith(
        "tenant-1",
        "wf-1",
      );
      expect(res.json).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("createWorkflow", () => {
    it("should create workflow and respond 201", async () => {
      workflowService.createWorkflow.mockResolvedValue({ id: "wf-1" });
      req.body = { name: "Test" };

      await workflowController.createWorkflow(req, res, next);

      expect(workflowService.createWorkflow).toHaveBeenCalledWith("tenant-1", {
        name: "Test",
      });
      // 201 must land in statusCode, not in meta.
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "wf-1" },
        null,
        "Workflow created successfully",
        201,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("updateWorkflow", () => {
    it("should update workflow", async () => {
      workflowService.updateWorkflow.mockResolvedValue({ id: "wf-1" });
      req.params = { id: "wf-1" };
      req.body = { name: "Updated" };

      await workflowController.updateWorkflow(req, res, next);

      expect(workflowService.updateWorkflow).toHaveBeenCalledWith(
        "tenant-1",
        "wf-1",
        { name: "Updated" },
      );
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("deleteWorkflow", () => {
    it("should delete workflow", async () => {
      workflowService.deleteWorkflow.mockResolvedValue(true);
      req.params = { id: "wf-1" };

      await workflowController.deleteWorkflow(req, res, next);

      expect(workflowService.deleteWorkflow).toHaveBeenCalledWith(
        "tenant-1",
        "wf-1",
      );
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("getPendingTasks", () => {
    it("should return pending tasks for the requesting user", async () => {
      workflowService.getPendingTasks.mockResolvedValue([]);

      await workflowController.getPendingTasks(req, res, next);

      expect(workflowService.getPendingTasks).toHaveBeenCalledWith(
        "tenant-1",
        req.user,
      );
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("submitAction", () => {
    it("should submit action and echo the resulting status", async () => {
      workflowService.submitAction.mockResolvedValue({
        message: "done",
        status: "APPROVED",
      });
      req.params = { instanceId: "inst-1" };
      req.body = { action: "APPROVED" };

      await workflowController.submitAction(req, res, next);

      expect(workflowService.submitAction).toHaveBeenCalledWith(
        "tenant-1",
        "inst-1",
        req.user,
        { action: "APPROVED" },
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { status: "APPROVED" },
        null,
        "done",
      );
      expect(res.json).toHaveBeenCalled();
    });
  });
});
