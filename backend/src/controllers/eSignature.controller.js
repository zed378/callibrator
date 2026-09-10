/**
 * E-Signature Controller (21 CFR Part 11)
 *
 * Handles digital signature workflow endpoints.
 */

const eSignatureService = require("../services/eSignature.service");
const { success, error } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { logger } = require("../middlewares/activityLog.middleware");

/**
 * Get all key pairs for the tenant
 */
exports.getKeyPairs = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const keyPairs = await eSignatureService.getKeyPairs(tenantId);

  return success(res, { keyPairs: keyPairs || [] }, "Key pairs retrieved");
});

/**
 * Generate RSA key pair for digital signatures
 */
exports.createKeyPair = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const result = await eSignatureService.generateKeyPair(tenantId);

  // success(res, data, meta, message, statusCode) — passing 201 third put it
  // in `meta` and left the response at HTTP 200.
  return success(res, result, null, "Key pair generated", 201);
});

/**
 * Delete a key pair
 */
exports.deleteKeyPair = asyncHandler(async (req, res) => {
  const { keyPairId } = req.params;
  const { tenantId } = req.user;

  await eSignatureService.deleteKeyPair(keyPairId, tenantId);

  return success(res, null, "Key pair deleted");
});

/**
 * Get all workflows for the tenant
 */
exports.getWorkflows = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { status } = req.query;

  const workflows = await eSignatureService.getWorkflows(tenantId, { status });

  return success(res, { workflows: workflows || [] }, "Workflows retrieved");
});

/**
 * Create signature workflow
 */
exports.createWorkflow = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { documentId, signers, subject, message, expiresAt } = req.body;

  const result = await eSignatureService.createSignatureWorkflow(tenantId, {
    documentId,
    signers,
    subject,
    message,
    expiresAt,
  });

  return success(res, result, null, "Signature workflow created", 201);
});

/**
 * Get workflow details
 */
exports.getWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;

  const workflow = await eSignatureService.getWorkflow(workflowId);

  return success(res, workflow, "Workflow retrieved");
});

/**
 * Update a workflow
 */
exports.updateWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const { tenantId } = req.user;

  const result = await eSignatureService.updateWorkflow(
    workflowId,
    tenantId,
    req.body,
  );

  return success(res, result, "Workflow updated");
});

/**
 * Delete a workflow
 */
exports.deleteWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const { tenantId } = req.user;

  await eSignatureService.deleteWorkflow(workflowId, tenantId);

  return success(res, null, "Workflow deleted");
});

/**
 * Sign a document
 */
exports.signDocument = asyncHandler(async (req, res) => {
  // stepId comes from the validated body: the route is POST /sign and has no
  // :stepId param, so req.params.stepId was always undefined.
  const {
    stepId,
    polygon,
    biometricData,
    authenticationMethod,
    ipAddress,
    userAgent,
  } = req.body;
  // req.user exposes `id`; there is no `userId` on it.
  const { id: userId } = req.user;

  const result = await eSignatureService.signDocument(stepId, userId, {
    polygon,
    biometricData,
    authenticationMethod,
    // Fall back to the real connection details when the client omits them —
    // 21 CFR Part 11 expects these on the signature record.
    ipAddress: ipAddress || req.ip,
    userAgent: userAgent || req.get("user-agent"),
  });

  return success(res, result, "Document signed");
});

/**
 * Verify a signature
 */
exports.verifySignature = asyncHandler(async (req, res) => {
  // Body, not params: the route is POST /verify with no :signatureId.
  const { signatureId } = req.body;

  const result = await eSignatureService.verifySignature(signatureId);

  return success(res, result, "Signature verified");
});

/**
 * Get signature history / audit trail
 */
exports.getSignatureHistory = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { userId, startDate, endDate } = req.query;

  const history = await eSignatureService.getSignatureHistory(tenantId, {
    userId,
    startDate,
    endDate,
  });

  return success(res, { signatures: history || [] }, "Signature history retrieved");
});

/**
 * Cancel a workflow
 */
exports.cancelWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  // req.user exposes `id`, not `userId`.
  const { id: userId, tenantId } = req.user;

  await eSignatureService.cancelWorkflow(workflowId, userId, tenantId);

  return success(res, null, "Workflow cancelled");
});

/**
 * Revoke a signature
 */
exports.revokeSignature = asyncHandler(async (req, res) => {
  const { signatureId } = req.params;
  // req.user exposes `id`, not `userId`.
  const { id: userId, tenantId } = req.user;
  const { reason } = req.body;

  await eSignatureService.revokeSignature(
    signatureId,
    userId,
    tenantId,
    reason,
  );

  return success(res, null, "Signature revoked");
});

/**
 * Get service status
 */
exports.getStatus = asyncHandler(async (req, res) => {
  const status = eSignatureService.getStatus();

  return success(res, status, "Service status retrieved");
});

