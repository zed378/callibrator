const workflowService = require("../services/workflow.service");
const { success } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");

// NOTE: this controller previously imported `successResponse`, which
// response.util.js does not export — every handler threw
// "successResponse is not a function" and returned 500. It now uses the
// exported `success(res, data, meta, message, statusCode)` like the rest of
// the controllers.
//
// Tenant id comes from `req.tenantId` rather than `req.tenant.id`: auth
// middleware sets both, but `req.tenant` is null for tenant-less accounts,
// and `req.tenantId` also reflects a super-admin's x-tenant-id override.

exports.getWorkflows = asyncHandler(async (req, res) => {
  const workflows = await workflowService.getWorkflows(req.tenantId);
  success(res, workflows, null, "Workflows retrieved successfully");
});

exports.getWorkflowById = asyncHandler(async (req, res) => {
  const workflow = await workflowService.getWorkflowById(
    req.tenantId,
    req.params.id,
  );
  success(res, workflow, null, "Workflow retrieved successfully");
});

exports.createWorkflow = asyncHandler(async (req, res) => {
  const workflow = await workflowService.createWorkflow(req.tenantId, req.body);
  success(res, workflow, null, "Workflow created successfully", 201);
});

exports.updateWorkflow = asyncHandler(async (req, res) => {
  const workflow = await workflowService.updateWorkflow(
    req.tenantId,
    req.params.id,
    req.body,
  );
  success(res, workflow, null, "Workflow updated successfully");
});

exports.deleteWorkflow = asyncHandler(async (req, res) => {
  await workflowService.deleteWorkflow(req.tenantId, req.params.id);
  success(res, null, null, "Workflow deleted successfully");
});

exports.getPendingTasks = asyncHandler(async (req, res) => {
  // Pass the whole user object because we need user.id and user.roleId
  const tasks = await workflowService.getPendingTasks(req.tenantId, req.user);
  success(res, tasks, null, "Pending tasks retrieved successfully");
});

exports.submitAction = asyncHandler(async (req, res) => {
  const result = await workflowService.submitAction(
    req.tenantId,
    req.params.instanceId,
    req.user,
    req.body,
  );
  success(res, { status: result.status }, null, result.message);
});
