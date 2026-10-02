/**
 * E-Signature Controller (21 CFR Part 11)
 *
 * Handles digital signature workflow endpoints.
 *
 * P9-20 (ADR-087): converted from eSignature.controller.js, behaviour
 * unchanged. `req.user`, `req.params`, `req.query` and `req.body` are read
 * INLINE as the JavaScript read them (a missing user throws the same
 * TypeError, inside the wrapper). Everything it required at load is captured
 * at load, in its order (`principalHasMenuPermission` destructured from the
 * gate's module, as before). `export =` keeps the exact object `require()`
 * returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import eSignatureService from "../services/eSignature.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// The `.js` destructured `logger` and never used it: the module load is kept.
import "../middlewares/activityLog.middleware";
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-104).
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import { principalHasMenuPermission as loadedPrincipalHasMenuPermission } from "../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS as LOADED_MENU_SLUGS } from "../constants";
import type { TenantId, UserId } from "../types/ids";

const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;
const principalHasMenuPermission = loadedPrincipalHasMenuPermission;
const MENU_SLUGS = LOADED_MENU_SLUGS;

/** The principal `auth` set: destructured from `req.user` INLINE, so a missing user throws the same TypeError (its message names `req.user`). */
interface SignaturePrincipal {
  id: UserId;
  tenantId: TenantId;
}

/**
 * Get all key pairs for the tenant
 */
const getKeyPairs = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as SignaturePrincipal;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built (ADR-038 rule 3)
  const keyPairs = (await eSignatureService.getKeyPairs(tenantId)) || [];

  // A-113: rows in `data`, the count in a top-level `meta` — the envelope
  // (CLAUDE.md). It used to wrap the rows as `data.keyPairs`.
  return success(res, keyPairs, { total: keyPairs.length }, "Key pairs retrieved");
});

/**
 * Generate RSA key pair for digital signatures
 */
const createKeyPair = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as SignaturePrincipal;

  const result = await eSignatureService.generateKeyPair(tenantId, auditActor(req));

  // success(res, data, meta, message, statusCode) — passing 201 third put it
  // in `meta` and left the response at HTTP 200.
  return success(res, result, null, "Key pair generated", 201);
});

/**
 * Delete a key pair
 */
const deleteKeyPair = asyncHandler(async (req: Request, res: Response) => {
  const { keyPairId } = req.params as { keyPairId: string };
  const { tenantId } = req.user as SignaturePrincipal;

  await eSignatureService.deleteKeyPair(keyPairId, tenantId, auditActor(req));

  // success(res, data, meta, message): the message was passed as `meta`.
  return success(res, null, null, "Key pair deleted");
});

/**
 * Get all workflows for the tenant.
 *
 * A-106 — rows in `data`, the count in a top-level `meta` (the envelope rule).
 * They used to be wrapped as `data.workflows`.
 */
const getWorkflows = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as SignaturePrincipal;
  const { status } = req.query as { status?: string };

  const workflows = await eSignatureService.getWorkflows(tenantId, { status });

  return success(res, workflows, { total: workflows.length }, "Workflows retrieved");
});

/** A new workflow's body, as `validate(createWorkflow)` left it. */
type WorkflowBody = Parameters<typeof eSignatureService.createSignatureWorkflow>[1];

/**
 * Create signature workflow
 */
const createWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as SignaturePrincipal;
  const { documentId, signers, subject, message, expiresAt } = req.body as WorkflowBody;

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
const getWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params as { workflowId: string };
  const { tenantId } = req.user as SignaturePrincipal;

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
const getEligibleSigners = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as SignaturePrincipal;

  const signers = await eSignatureService.getEligibleSigners(tenantId);

  return success(res, signers, { total: signers.length }, "Eligible signers retrieved");
});

/**
 * A-91 — GET /my-workflows: the workflows naming the caller as a signer.
 * Rows in `data`, the count in a top-level `meta` (the envelope rule).
 */
const getSignerWorkflows = asyncHandler(async (req: Request, res: Response) => {
  const { id: userId, tenantId } = req.user as SignaturePrincipal;
  const { stepStatus } = req.query as { stepStatus?: string };

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
 * A-91 — GET /my-workflows/:workflowId: one workflow the caller is named in.
 * 404 when it is not theirs to sign, whatever the reason.
 */
const getSignerWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params as { workflowId: string };
  const { id: userId, tenantId } = req.user as SignaturePrincipal;

  const workflow = await eSignatureService.getSignerWorkflow(workflowId, tenantId, userId);

  return success(res, workflow, "Workflow retrieved");
});

/**
 * Update a workflow
 */
const updateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params as { workflowId: string };
  const { tenantId } = req.user as SignaturePrincipal;

  // A-09: PUT /workflows/:workflowId carries no body validator, so an absent
  // body reached the service as `undefined` and its destructure threw — a 500
  // where the caller was owed a 400.
  const result = await eSignatureService.updateWorkflow(
    workflowId,
    tenantId,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {} (ADR-038 rule 3)
    (req.body || {}) as Record<string, unknown>,
    auditActor(req),
  );

  return success(res, result, "Workflow updated");
});

/**
 * Delete a workflow
 */
const deleteWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params as { workflowId: string };
  const { tenantId } = req.user as SignaturePrincipal;

  await eSignatureService.deleteWorkflow(workflowId, tenantId, auditActor(req));

  return success(res, null, "Workflow deleted");
});

/** The signing body, as `validate(signDocument)` left it. */
interface SignBody {
  stepId: string;
  polygon?: unknown;
  biometricData?: unknown;
  authenticationMethod?: string | null;
  authPayload?: unknown;
  reason?: unknown;
}

/**
 * Sign a document
 */
const signDocument = asyncHandler(async (req: Request, res: Response) => {
  // stepId comes from the validated body: the route is POST /sign and has no
  // :stepId param, so req.params.stepId was always undefined.
  const {
    stepId,
    polygon,
    biometricData,
    authenticationMethod,
    authPayload,
    reason,
  } = req.body as SignBody;
  // req.user exposes `id`; there is no `userId` on it.
  const { id: userId } = req.user as SignaturePrincipal;

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
const verifySignature = asyncHandler(async (req: Request, res: Response) => {
  // Body, not params: the route is POST /verify with no :signatureId.
  const { signatureId } = req.body as { signatureId: string };

  const result = await eSignatureService.verifySignature(signatureId);

  return success(res, result, "Signature verified");
});

/** The history query (raw strings; the service coerces). */
interface HistoryQuery {
  userId?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}

/**
 * Get signature history / audit trail.
 *
 * A-106 — rows in `data`, the count in a top-level `meta`. They used to be
 * wrapped as `data.signatures`. D-24 (ADR-070) — one page of them: `meta`
 * carries total, page, limit and totalPages.
 */
const getSignatureHistory = asyncHandler(async (req: Request, res: Response) => {
  const { id: callerId, tenantId } = req.user as SignaturePrincipal;
  const { userId, startDate, endDate, page, limit } = req.query as HistoryQuery;

  // A-129 (ADR-051 Q-19, F-9) — the tenant's history is workflow management
  // (`qms` read). Without it the route still answers, with the caller's own
  // signatures only and without their IP address, user agent or biometrics.
  const canManage = await principalHasMenuPermission(
    req.user as Parameters<typeof principalHasMenuPermission>[0],
    MENU_SLUGS.QMS,
    "read",
  );

  const filters: Parameters<typeof eSignatureService.getSignatureHistory>[1] = { userId, startDate, endDate, page, limit };
  const history = await eSignatureService.getSignatureHistory(
    tenantId,
    filters,
    { callerId, canManage },
  );

  return success(res, history.rows, history.meta, "Signature history retrieved");
});

/**
 * Cancel a workflow
 */
const cancelWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params as { workflowId: string };
  // req.user exposes `id`, not `userId`.
  const { id: userId, tenantId } = req.user as SignaturePrincipal;

  // A-130 — `reason` is optional and goes into the CANCEL audit row.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {} (ADR-038 rule 3)
  const { reason } = (req.body || {}) as { reason?: string | null };

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
 * Get service status
 */
// The `.js` declared `req` and never read it; the wrapper's signature is kept.
// eslint-disable-next-line @typescript-eslint/require-await -- as built: an async handler, so a throw becomes a rejection the wrapper catches
const getStatus = asyncHandler(async (_req: Request, res: Response) => {
  const status = eSignatureService.getStatus();

  return success(res, status, "Service status retrieved");
});

export = {
  getKeyPairs,
  createKeyPair,
  deleteKeyPair,
  getWorkflows,
  createWorkflow,
  getWorkflow,
  getEligibleSigners,
  getSignerWorkflows,
  getSignerWorkflow,
  updateWorkflow,
  deleteWorkflow,
  signDocument,
  verifySignature,
  getSignatureHistory,
  cancelWorkflow,
  getStatus,
};
