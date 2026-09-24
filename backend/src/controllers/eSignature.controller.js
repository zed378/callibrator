/**
 * E-Signature Controller (21 CFR Part 11)
 *
 * Handles digital signature workflow endpoints.
 */

const eSignatureService = require("../services/eSignature.service");
const { success, error } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { logger } = require("../middlewares/activityLog.middleware");
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-104).
const { auditActor } = require("../utils/auditActor.util");
const { principalHasMenuPermission } = require("../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../constants");

/**
 * Get all key pairs for the tenant
 */
exports.getKeyPairs = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const keyPairs = (await eSignatureService.getKeyPairs(tenantId)) || [];

  // A-113: rows in `data`, the count in a top-level `meta` — the envelope
  // (CLAUDE.md). It used to wrap the rows as `data.keyPairs`.
  return success(res, keyPairs, { total: keyPairs.length }, "Key pairs retrieved");
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
 * Get all workflows for the tenant.
 *
 * A-106 — rows in `data`, the count in a top-level `meta` (the envelope rule).
 * They used to be wrapped as `data.workflows`.
 */
exports.getWorkflows = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { status } = req.query;

  const workflows = await eSignatureService.getWorkflows(tenantId, { status });

  return success(res, workflows, { total: workflows.length }, "Workflows retrieved");
});

/**
 * Create signature workflow
 */
exports.createWorkflow = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { documentId, signers, subject, message, expiresAt } = req.body;

  // A-129 — the service writes the CREATE audit row inside its transaction,
  // so it needs who did it (auditActor), as every other workflow mutation.
  const result = await eSignatureService.createSignatureWorkflow(
    tenantId,
    {
      documentId,
      signers,
      subject,
      message,
      expiresAt,
    },
    auditActor(req),
  );

  return success(res, result, null, "Signature workflow created", 201);
});

/**
 * Get workflow details
 */
exports.getWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const { tenantId } = req.user;

  // A-105 — the service scopes by the caller's tenant explicitly and throws
  // 404 for a workflow it cannot find (another tenant's included). A database
  // failure propagates as a 500; it is no longer reported as not-found.
  const workflow = await eSignatureService.getWorkflow(workflowId, tenantId);

  return success(res, workflow, "Workflow retrieved");
});

/**
 * A-129 — GET /signers: the users a new workflow may name as signers (active,
 * holding `esignature:write`). Rows in `data`, the count in a top-level `meta`.
 */
exports.getEligibleSigners = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const signers = await eSignatureService.getEligibleSigners(tenantId);

  return success(res, signers, { total: signers.length }, "Eligible signers retrieved");
});

/**
 * A-91 — GET /my-workflows: the workflows naming the caller as a signer.
 * Rows in `data`, the count in a top-level `meta` (the envelope rule).
 */
exports.getSignerWorkflows = asyncHandler(async (req, res) => {
  const { id: userId, tenantId } = req.user;
  const { stepStatus } = req.query;

  const workflows = await eSignatureService.getSignerWorkflows(tenantId, userId, {
    stepStatus,
  });

  return success(
    res,
    workflows,
    { total: workflows.length },
    "Signer workflows retrieved",
  );
});

/**
 * A-129 — GET /signers: the users a new workflow may name as signers (active,
 * holding `esignature:write`). Rows in `data`, the count in a top-level `meta`.
 */
exports.getEligibleSigners = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const signers = await eSignatureService.getEligibleSigners(tenantId);

  return success(res, signers, { total: signers.length }, "Eligible signers retrieved");
});

/**
 * A-91 — GET /my-workflows/:workflowId: one workflow the caller is named in.
 * 404 when it is not theirs to sign, whatever the reason.
 */
exports.getSignerWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const { id: userId, tenantId } = req.user;

  const workflow = await eSignatureService.getSignerWorkflow(workflowId, tenantId, userId);

  return success(res, workflow, "Workflow retrieved");
});

/**
 * Update a workflow
 */
exports.updateWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const { tenantId } = req.user;

  // A-09: PUT /workflows/:workflowId carries no body validator, so an absent
  // body reached the service as `undefined` and its destructure threw — a 500
  // where the caller was owed a 400.
  const result = await eSignatureService.updateWorkflow(
    workflowId,
    tenantId,
    req.body || {},
    auditActor(req),
  );

  return success(res, result, "Workflow updated");
});

/**
 * Delete a workflow
 */
exports.deleteWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const { tenantId } = req.user;

  await eSignatureService.deleteWorkflow(workflowId, tenantId, auditActor(req));

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
    authPayload,
    reason,
  } = req.body;
  // req.user exposes `id`; there is no `userId` on it.
  const { id: userId } = req.user;

  const result = await eSignatureService.signDocument(stepId, userId, {
    polygon,
    biometricData,
    authenticationMethod,
    // The signer's password or MFA code: re-authentication at the moment of
    // signing (A-65). Checked by the service, never persisted.
    authPayload,
    reason,
    // A-65 — the Part 11 record's IP address and user agent come from the
    // CONNECTION only. They used to be taken from the body first, so a client
    // could write whatever origin it liked onto a signature.
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
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
 * Get signature history / audit trail.
 *
 * A-106 — rows in `data`, the count in a top-level `meta`. They used to be
 * wrapped as `data.signatures`.
 */
exports.getSignatureHistory = asyncHandler(async (req, res) => {
  const { id: callerId, tenantId } = req.user;
  const { userId, startDate, endDate } = req.query;

  // A-129 (ADR-051 Q-19, F-9) — the tenant's history is workflow management
  // (`qms` read). Without it the route still answers, with the caller's own
  // signatures only and without their IP address, user agent or biometrics.
  const canManage = await principalHasMenuPermission(req.user, MENU_SLUGS.QMS, "read");

  const history = await eSignatureService.getSignatureHistory(
    tenantId,
    { userId, startDate, endDate },
    { callerId, canManage },
  );

  return success(res, history, { total: history.length }, "Signature history retrieved");
});

/**
 * Cancel a workflow
 */
exports.cancelWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  // req.user exposes `id`, not `userId`.
  const { id: userId, tenantId } = req.user;

  // A-130 — `reason` is optional and goes into the CANCEL audit row.
  const { reason } = req.body || {};

  await eSignatureService.cancelWorkflow(
    workflowId,
    userId,
    tenantId,
    auditActor(req),
    reason,
  );

  return success(res, null, "Workflow cancelled");
});

/**
 * Revoke a signature
 */
exports.revokeSignature = asyncHandler(async (req, res) => {
  const { signatureId } = req.params;
  // req.user exposes `id`, not `userId`.
  const { id: userId, tenantId } = req.user;
  const { reason } = req.body || {};

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

