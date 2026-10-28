import type { Request, Response } from "express";
import type * as ResponseUtil from "../../utils/response.util";

jest.mock("../../services/workflow.service", () => ({
  getWorkflows: jest.fn(),
  getWorkflowById: jest.fn(),
  createWorkflow: jest.fn(),
  updateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
  getPendingTasks: jest.fn(),
  submitAction: jest.fn(),
}));

interface FakeRes {
  status: (code: number) => FakeRes;
  json: jest.Mock;
}

// Mirrors the real success(res, data, meta, message, statusCode) signature.
// The previous version of this file mocked a `successResponse` export that
// response.util.js does not have — which is exactly why the controller's
// broken import went unnoticed while every route 500'd in production.
jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface WorkflowServiceDouble {
  getWorkflows: jest.Mock;
  getWorkflowById: jest.Mock;
  createWorkflow: jest.Mock;
  updateWorkflow: jest.Mock;
  deleteWorkflow: jest.Mock;
  getPendingTasks: jest.Mock;
  submitAction: jest.Mock;
}

interface ResponseDouble {
  success: jest.Mock;
}

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const workflowController = require("../../controllers/workflow.controller") as {
  getWorkflows: Handler;
  getWorkflowById: Handler;
  createWorkflow: Handler;
  updateWorkflow: Handler;
  deleteWorkflow: Handler;
  getPendingTasks: Handler;
  submitAction: Handler;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const workflowService = require("../../services/workflow.service") as WorkflowServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

describe("workflow Controller", () => {
  let req: Record<string, unknown>;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation(
      (response: FakeRes, data: unknown, meta: unknown, message: unknown, statusCode?: number) => {
        response.status(statusCode ?? 200).json({ success: true, status: statusCode, message, data, meta });
      },
    );
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
    const responseUtil = jest.requireActual<typeof ResponseUtil>("../../utils/response.util");
    expect((responseUtil as { successResponse?: unknown }).successResponse).toBeUndefined();
    expect(typeof responseUtil.success).toBe("function");
  });

  describe("getWorkflows", () => {
    it("should return workflows scoped to the request tenant", async () => {
      workflowService.getWorkflows.mockResolvedValue([{ id: "wf-1" }]);

      await workflowController.getWorkflows(req as unknown as Request, res as unknown as Response, next);

      expect(workflowService.getWorkflows).toHaveBeenCalledWith("tenant-1");
      expect(success).toHaveBeenCalledWith(res, [{ id: "wf-1" }], null, "Workflows retrieved successfully");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      workflowService.getWorkflows.mockRejectedValue(new Error("err"));
      await workflowController.getWorkflows(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("getWorkflowById", () => {
    it("should return workflow by id", async () => {
      workflowService.getWorkflowById.mockResolvedValue({ id: "wf-1" });
      req["params"] = { id: "wf-1" };

      await workflowController.getWorkflowById(req as unknown as Request, res as unknown as Response, next);

      expect(workflowService.getWorkflowById).toHaveBeenCalledWith("tenant-1", "wf-1");
      expect(res.json).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("createWorkflow", () => {
    it("should create workflow and respond 201", async () => {
      workflowService.createWorkflow.mockResolvedValue({ id: "wf-1" });
      req["body"] = { name: "Test" };

      await workflowController.createWorkflow(req as unknown as Request, res as unknown as Response, next);

      // A-204 — the caller is the audit row's actor.
      expect(workflowService.createWorkflow).toHaveBeenCalledWith(
        "tenant-1",
        { name: "Test" },
        expect.objectContaining({ userId: (req["user"] as { id: string }).id }),
      );
      // 201 must land in statusCode, not in meta.
      expect(success).toHaveBeenCalledWith(res, { id: "wf-1" }, null, "Workflow created successfully", 201);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("updateWorkflow", () => {
    it("should update workflow", async () => {
      workflowService.updateWorkflow.mockResolvedValue({ id: "wf-1" });
      req["params"] = { id: "wf-1" };
      req["body"] = { name: "Updated" };

      await workflowController.updateWorkflow(req as unknown as Request, res as unknown as Response, next);

      expect(workflowService.updateWorkflow).toHaveBeenCalledWith(
        "tenant-1",
        "wf-1",
        { name: "Updated" },
        expect.objectContaining({ userId: (req["user"] as { id: string }).id }),
      );
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("deleteWorkflow", () => {
    it("should delete workflow", async () => {
      workflowService.deleteWorkflow.mockResolvedValue(true);
      req["params"] = { id: "wf-1" };

      await workflowController.deleteWorkflow(req as unknown as Request, res as unknown as Response, next);

      expect(workflowService.deleteWorkflow).toHaveBeenCalledWith(
        "tenant-1",
        "wf-1",
        expect.objectContaining({ userId: (req["user"] as { id: string }).id }),
      );
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("getPendingTasks", () => {
    it("should return pending tasks for the requesting user", async () => {
      workflowService.getPendingTasks.mockResolvedValue([]);

      await workflowController.getPendingTasks(req as unknown as Request, res as unknown as Response, next);

      expect(workflowService.getPendingTasks).toHaveBeenCalledWith("tenant-1", req["user"]);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("submitAction", () => {
    it("should submit action and echo the resulting status", async () => {
      workflowService.submitAction.mockResolvedValue({
        message: "done",
        status: "APPROVED",
      });
      req["params"] = { instanceId: "inst-1" };
      req["body"] = { action: "APPROVED", ipAddress: "6.6.6.6", userAgent: "forged" };
      req["ip"] = "10.0.0.9";
      req["headers"] = { "user-agent": "browser" };

      await workflowController.submitAction(req as unknown as Request, res as unknown as Response, next);

      // A-182 — the Part 11 context comes from the connection; a body value
      // cannot forge it.
      expect(workflowService.submitAction).toHaveBeenCalledWith("tenant-1", "inst-1", req["user"], {
        action: "APPROVED",
        ipAddress: "10.0.0.9",
        userAgent: "browser",
      });
      expect(success).toHaveBeenCalledWith(res, { status: "APPROVED" }, null, "done");
      expect(res.json).toHaveBeenCalled();
    });
  });
});
