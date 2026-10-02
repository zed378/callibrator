/**
 * Certificate Controller
 *
 * Handles HTTP requests for certificate CRUD operations.
 *
 * P9-20 (ADR-087): converted from certificate.controller.js, behaviour
 * unchanged. `req.user`, `req.query`, `req.params`, `req.body`, `req.ip` and
 * `req.headers` are read INLINE as the JavaScript read them (a missing user
 * throws the same TypeError, inside the wrapper). Everything the JavaScript
 * required at load is captured at load, in its order. `export =` keeps the
 * exact object `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import certificateService from "../services/certificate.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// A-103 — every handler here forwards a service result envelope. Services
// RETURN their 404/409 outcomes; sendResult sends those down the error path
// (`success: false`), where `success(res, …, result.status)` sent them with
// `success: true`.
import { sendResult as loadedSendResult } from "../utils/response.util";
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-41).
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import {
  getCertificatesQuery as loadedListQuery,
  certificateIdSchema as loadedIdSchema,
  createCertificateSchema as loadedCreateSchema,
  updateCertificateSchema as loadedUpdateSchema,
  approveCertificateSchema as loadedApproveSchema,
  signCertificateSchema as loadedSignSchema,
  revokeCertificateSchema as loadedRevokeSchema,
} from "../validators/certificate.validator";
import { validateInput } from "../validators/input";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const sendResult = loadedSendResult;
const auditPrincipal = loadedAuditPrincipal;
const getCertificatesQuery = loadedListQuery;
const certificateIdSchema = loadedIdSchema;
const createCertificateSchema = loadedCreateSchema;
const updateCertificateSchema = loadedUpdateSchema;
const approveCertificateSchema = loadedApproveSchema;
const signCertificateSchema = loadedSignSchema;
const revokeCertificateSchema = loadedRevokeSchema;
const validate = validateInput;

/** The principal `auth` set (read without a guard, as before). */
interface CertificatePrincipal {
  tenantId: TenantId;
  id: UserId;
}
const userOf = (req: Request): CertificatePrincipal => req.user as CertificatePrincipal;
/** The User-Agent header as Node gives it (read as the JavaScript read it). */
const userAgentOf = (req: Request): string | null => req.headers["user-agent"] as string | null;

/**
 * GET /api/certificates
 * List all certificates with pagination and filtering
 */
const getAllCertificates = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const validated = validate(req.query, getCertificatesQuery);
  const result = await certificateService.fetchCertificates({
    tenantId,
    page: validated.page,
    limit: validated.limit,
    deviceId: validated.deviceId,
    status: validated.status,
    type: validated.type,
    certificateNumber: validated.certificateNumber,
    from: validated.from,
    to: validated.to,
    sortBy: validated.sortBy,
    sortOrder: validated.sortOrder,
  });

  // The list result nests rows and meta inside `data`; the envelope puts rows
  // in `data` and meta beside it.
  sendResult(res, { ...result, data: result.data.rows }, result.data.meta);
});

/**
 * GET /api/certificates/:certificateId
 * Get a specific certificate
 */
const getSpecificCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateService.fetchSpecificCertificate(
    tenantId,
    certificateId,
  );

  sendResult(res, result);
});

/**
 * POST /api/certificates
 * Create a new certificate
 */
const createCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  // A-282 (ADR-100): an API key is no user — createdBy (an FK to users) is
  // null for it, and the audit row names `system:api-key`.
  const principal = auditPrincipal(req);
  const validated = validate(req.body, createCertificateSchema);
  const result = await certificateService.createCertificate(
    tenantId,
    principal.userId as UserId | null,
    validated,
    principal,
  );

  sendResult(res, result);
});

/**
 * PUT /api/certificates/:certificateId
 * Update a certificate
 */
const updateCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, updateCertificateSchema);
  const result = await certificateService.updateCertificate(
    tenantId,
    certificateId,
    { ...validated, updatedBy: auditPrincipal(req).userId },
    auditPrincipal(req),
  );

  sendResult(res, result);
});

/**
 * DELETE /api/certificates/:certificateId
 * Delete a certificate
 */
const deleteCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateService.deleteCertificate(
    tenantId,
    certificateId,
    auditPrincipal(req),
  );

  sendResult(res, result);
});

/**
 * POST /api/certificates/:certificateId/approve
 * Approve a certificate
 */
const approveCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, approveCertificateSchema);
  // A-62 — the approver is the caller, never the body: the schema strips any
  // `approvedBy`, and this is the only id the service re-authenticates, stamps
  // on the certificate and writes as the audit row's userId.
  const result = await certificateService.approveCertificate(
    tenantId,
    certificateId,
    userOf(req).id,
    {
      authMethod: validated.authMethod,
      authPayload: validated.authPayload,
      meaning: validated.meaning,
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    },
  );

  sendResult(res, result);
});

/**
 * POST /api/certificates/:certificateId/submit
 * Submit a draft certificate for approval
 */
const submitCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateService.submitCertificateForApproval(
    tenantId,
    certificateId,
    auditPrincipal(req),
  );
  sendResult(res, result);
});

/**
 * POST /api/certificates/:certificateId/sign
 * Sign a certificate digitally
 */
const signCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, signCertificateSchema);
  const result = await certificateService.signCertificate(
    tenantId,
    certificateId,
    validated.digitalSignature,
    validated.digitalSignatureKeyId,
    userOf(req).id,
    {
      authMethod: validated.authMethod,
      authPayload: validated.authPayload,
      meaning: validated.meaning,
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    },
  );

  sendResult(res, result);
});

/**
 * POST /api/certificates/:certificateId/revoke
 * Revoke a certificate
 */
const revokeCertificate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, revokeCertificateSchema);
  const result = await certificateService.revokeCertificate(
    tenantId,
    certificateId,
    validated.reason,
    userOf(req).id,
    {
      authMethod: validated.authMethod,
      authPayload: validated.authPayload,
      meaning: validated.meaning,
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    },
  );

  sendResult(res, result);
});

/**
 * GET /api/certificates/stats
 * Get certificate statistics
 */
const getCertificateStats = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const result = await certificateService.getCertificateStats(tenantId);

  sendResult(res, result);
});

export = {
  getAllCertificates,
  getSpecificCertificate,
  createCertificate,
  updateCertificate,
  deleteCertificate,
  approveCertificate,
  submitCertificate,
  signCertificate,
  revokeCertificate,
  getCertificateStats,
};
