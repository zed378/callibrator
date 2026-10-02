/**
 * Approval workflows: definitions and the decision inbox, `/api/v1/workflows`.
 *
 * P9-21 (ADR-087): converted from workflow.controller.js, behaviour unchanged.
 * `req.tenantId`, `req.user`, `req.params`, `req.body`, `req.ip` and
 * `req.headers` are read INLINE as the JavaScript read them. Everything it
 * required at load is captured at load, in its order; the service is called
 * through its module object (a class instance). `export =` keeps the exact
 * object `require()` returned (the same keys, in the same order).
 *
 * NOTE (as built): this controller once imported `successResponse`, which
 * response.util does not export — every handler threw and returned 500. It uses
 * the exported `success(res, data, meta, message, statusCode)`.
 *
 * Tenant id comes from `req.tenantId` rather than `req.tenant.id`: auth
 * middleware sets both, but `req.tenant` is null for tenant-less accounts,
 * and `req.tenantId` also reflects a super-admin's x-tenant-id override.
 */
import type { Request, Response } from "express";
import workflowService from "../services/workflow.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// A-282 (ADR-100): an API key (workflows:write) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";

const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;
const auditPrincipal = loadedAuditPrincipal;

/** The service's own parameter types, read off the instance's methods. */
type Svc = typeof workflowService;
const tenantOf = (req: Request): TenantId => req.tenantId as TenantId;

const getWorkflows = asyncHandler(async (req: Request, res: Response) => {
  const workflows = await workflowService.getWorkflows(tenantOf(req));
  success(res, workflows, null, "Workflows retrieved successfully");
});

const getWorkflowById = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await workflowService.getWorkflowById(
    tenantOf(req),
    (req.params as { id: string }).id,
  );
  success(res, workflow, null, "Workflow retrieved successfully");
});

const createWorkflow = asyncHandler(async (req: Request, res: Response) => {
  // A-204 — definition changes are audited; the actor is the caller.
  const workflow = await workflowService.createWorkflow(
    tenantOf(req),
    req.body as Parameters<Svc["createWorkflow"]>[1],
    auditPrincipal(req),
  );
  success(res, workflow, null, "Workflow created successfully", 201);
});

const updateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await workflowService.updateWorkflow(
    tenantOf(req),
    (req.params as { id: string }).id,
    req.body as Parameters<Svc["updateWorkflow"]>[2],
    auditPrincipal(req),
  );
  success(res, workflow, null, "Workflow updated successfully");
});

const deleteWorkflow = asyncHandler(async (req: Request, res: Response) => {
  await workflowService.deleteWorkflow(tenantOf(req), (req.params as { id: string }).id, auditPrincipal(req));
  success(res, null, null, "Workflow deleted successfully");
});

const getPendingTasks = asyncHandler(async (req: Request, res: Response) => {
  // Pass the whole user object because we need user.id and user.roleId
  const tasks = await workflowService.getPendingTasks(tenantOf(req), req.user as Parameters<Svc["getPendingTasks"]>[1]);
  success(res, tasks, null, "Pending tasks retrieved successfully");
});

const submitAction = asyncHandler(async (req: Request, res: Response) => {
  // A-182 — the Part 11 context of a certificate approval comes from the
  // connection, never the body (A-65).
  // The body `validate(submitActionSchema)` left, with the connection's context (never the body's).
  const decision: Parameters<Svc["submitAction"]>[3] = {
    ...(req.body as Parameters<Svc["submitAction"]>[3]),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
  const result = await workflowService.submitAction(
    tenantOf(req),
    (req.params as { instanceId: string }).instanceId,
    req.user as Parameters<Svc["submitAction"]>[2],
    decision,
  );
  success(res, { status: result.status }, null, result.message);
});

export = {
  getWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getPendingTasks,
  submitAction,
};
