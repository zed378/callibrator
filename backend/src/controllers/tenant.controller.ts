// P9-20 (ADR-087; converted under the four isolation gates): from
// tenant.controller.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order). The two
// services are the module objects; every other load-time destructure is kept
// as a capture at load. The lazy requires of upload.util and the logger (only
// on a failure path) stay lazy. Request data is read through typed views of
// the request; the emitted expressions are the `.js` ones. A validated tenant
// id becomes a `TenantId` through `toTenantId`, which cannot throw here:
// `z.guid()` has already accepted exactly the shape it checks.
import type { NextFunction, Request, Response } from "express";

import tenantService from "../services/tenant.service";
import tenantUploadService from "../services/tenantUpload.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess, sendResult as loadedSendResult } from "../utils/response.util";
import {
  getAllTenantsQuery as loadedGetAllTenantsQuery,
  getTenantSchema as loadedGetTenantSchema,
  createTenantSchema as loadedCreateTenantSchema,
  updateTenantSchema as loadedUpdateTenantSchema,
  deleteTenantSchema as loadedDeleteTenantSchema,
  tenantIdSchema as loadedTenantIdSchema,
} from "../validators/tenant.validator";
import { validateInput as loadedValidate } from "../validators/input";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
// A-273: the path names the resource — path params win, a differing body id is 400.
import { withPathParams as loadedWithPathParams } from "../utils/pathParams.util";
import type * as UploadUtil from "../utils/upload.util";
import type * as ActivityLog from "../middlewares/activityLog.middleware";
import { toTenantId } from "../types/ids";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const sendResult = loadedSendResult;
const getAllTenantsQuery = loadedGetAllTenantsQuery;
const getTenantSchema = loadedGetTenantSchema;
const createTenantSchema = loadedCreateTenantSchema;
const updateTenantSchema = loadedUpdateTenantSchema;
const deleteTenantSchema = loadedDeleteTenantSchema;
const tenantIdSchema = loadedTenantIdSchema;
const validate = loadedValidate;
const auditActor = loadedAuditActor;
const auditPrincipal = loadedAuditPrincipal;
const isSuperAdmin = loadedIsSuperAdmin;
const withPathParams = loadedWithPathParams;

/** The request as `auth` and the upload middleware leave it. */
type TenantRequest = Request & {
  user?: { id?: UserId | null; tenantId?: TenantId | null; role?: { name?: string | null } | null };
  file?: unknown;
  uploadFilename?: string;
};

/** A tenant service's own response object. */
interface ServiceResult {
  success?: boolean | undefined;
  status?: number | undefined;
  message?: string | undefined;
  data?: unknown;
  meta?: object | null | undefined;
}

/** The body, as a JavaScript caller sends it (a plain object, or none). */
const bodyOf = (req: Request): Record<string, unknown> | undefined => req.body as Record<string, unknown> | undefined;

/** The path parameters, which on these routes are all `:param` strings. */
const paramsOf = (req: Request): Record<string, string> => req.params as Record<string, string>;

/**
 * A-63. The principal a tenant mutation is checked against: the audit actor
 * (A-41) plus whether it is a super admin. Taken from the authenticated user
 * only — never from the body, the query or an x-tenant-* header.
 *
 * @param {import("express").Request} req
 * @returns {{userId: string|null, apiKeyId: string|null, tenantId: string|null,
 *   ipAddress: string|null, userAgent: string|null, actorIsSuperAdmin: boolean}}
 */
const tenantActor = (
  req: TenantRequest,
): ReturnType<typeof auditPrincipal> & { tenantId: TenantId | null; actorIsSuperAdmin: boolean } => {
  return {
    // A-282 (ADR-100): an API key (tenant scopes) is audited as
    // system:api-key; its tenant is still the one it may change.
    ...auditPrincipal(req),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain -- as built: `(req.user && req.user.tenantId) || null`
    tenantId: (req.user && req.user.tenantId) || null,
    actorIsSuperAdmin: isSuperAdmin(req.user),
  };
};

/**
 * A-112. Send a tenant service result down the path its status belongs on
 * (utils/response.util#sendResult, A-103). Each handler used to special-case
 * `status === 404` by hand and forward everything else through success(), so
 * any other non-2xx result — a 409, a 403 — went out with `success: true`.
 *
 * The handler's default message and status apply only to a successful result:
 * a failure without a message must not be announced as, say, "Tenant created
 * successfully".
 *
 * @param {import("express").Response} res
 * @param {{success?: boolean, status?: number, message?: string, data?: *}} result
 * @param {string} defaultMessage - for a successful result that carries none
 * @param {number} defaultStatus - for a result that carries none
 * @param {Object|null} [meta] - pagination for a list
 */
const sendTenantResult = (
  res: Response,
  result: ServiceResult,
  defaultMessage: string,
  defaultStatus: number,
  meta: object | null = null,
): Response => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status reads as the default
  const status = result.status || defaultStatus;
  const failed = result.success === false || status >= 400;
  return sendResult(
    res,
    {
      ...result,
      status,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message reads as the default (or none on a failure)
      message: result.message || (failed ? undefined : defaultMessage),
    },
    meta,
  );
};

const getAllTenants = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.query, getAllTenantsQuery);
  const result = await tenantService.fetchTenants(validated);

  // Rows in `data`, pagination in a top-level `meta`. A failed result carries
  // no page; it goes down the error path and the meta is ignored.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `result.data || {}`
  const page = (result.data || {}) as { data?: unknown; rows?: unknown; meta?: object | null };
  sendTenantResult(
    res,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `page.data || page.rows`
    { ...result, data: page.data || page.rows },
    "Fetch tenants successful",
    200,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `page.meta || result.meta || null`
    page.meta || (result as ServiceResult).meta || null,
  );
});

const getSpecificTenant = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate({ ...bodyOf(req), ...req.params }, getTenantSchema);
  const result = await tenantService.fetchSpecificTenant(toTenantId(validated.tenantId));

  sendTenantResult(res, result, "Fetch tenant successful", 200);
});

/**
 * Public (no-auth) tenant branding for the login/register page. The
 * deploy-configured tenant id arrives via the `X-Tenant-ID` header (injected by
 * the frontend proxy from NEXT_PUBLIC_TENANT_ID); a query/param fallback is
 * accepted. Returns only non-sensitive branding fields.
 */
const getPublicBranding = asyncHandler(async (req: Request, res: Response) => {
  const tenantId =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty header or query falls through
    req.headers["x-tenant-id"] || req.query["tenantId"] || req.params["tenantId"];

  const validated = validate({ tenantId }, getTenantSchema);
  const branding = await tenantService.getPublicBranding(toTenantId(validated.tenantId));

  if (!branding) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: "Tenant not found",
      data: null,
    });
  }

  success(res, branding, null, "Fetch tenant branding successful", 200);
  return undefined;
});

const createTenant = asyncHandler(async (req: Request, res: Response, next?: NextFunction) => {
  const r = req as TenantRequest;
  try {
    const validated = validate(r.body, createTenantSchema);
    const createdBy = r.user?.id;
    const uploadedFilename = r.file ? r.uploadFilename : null;

    const inputData: Record<string, unknown> = { ...validated };
    // A-79: the logo is only ever the file this request uploaded, never a
    // filename from the body (which could name another tenant's file).
    delete inputData["logo"];

    if (uploadedFilename) {
      inputData["logo"] = uploadedFilename;
    }

    // A-95: the service audits the create inside its transaction.
    const result = await tenantService.createTenant(inputData, createdBy, auditActor(req));

    sendTenantResult(res, result, "Tenant created successfully", 201);
  } catch (err) {
    if (r.file) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only on this failure path
        await (require("../utils/upload.util") as typeof UploadUtil).deleteUpload(
          r.uploadFilename as string,
          "uploads/public/tenant",
        );
      } catch (deleteErr) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only on this failure path
        (require("../middlewares/activityLog.middleware") as typeof ActivityLog).logger.warn(
          `Failed to delete uploaded file after failure: ${String(r.uploadFilename)}`,
          deleteErr,
        );
      }
    }
    (next as NextFunction)(err);
  }
});

/**
 * A-79. Remove the file THIS request uploaded, after the update was refused or
 * failed. Never throws: the original error is what the caller must see.
 *
 * @param {import("express").Request} req
 */
const discardUploadedLogo = async (req: TenantRequest): Promise<void> => {
  if (!req.file) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only on this failure path
    await (require("../utils/upload.util") as typeof UploadUtil).deleteUpload(req.uploadFilename as string, "uploads/public/tenant");
  } catch (deleteErr) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only on this failure path
    (require("../middlewares/activityLog.middleware") as typeof ActivityLog).logger.warn(
      `Failed to delete uploaded file after failure: ${String(req.uploadFilename)}`,
      deleteErr,
    );
  }
};

const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const r = req as TenantRequest;
  let result;
  try {
    // A-273: the path's tenantId wins; a body naming another tenant is 400.
    const validated = validate(withPathParams(paramsOf(req), bodyOf(req)), updateTenantSchema);
    const updatedBy = r.user?.id;
    const uploadedFilename = r.file ? r.uploadFilename : null;

    const inputData: Record<string, unknown> = { ...validated };
    // A-79: the logo is only ever the file this request uploaded. A body
    // `logo` could name another tenant's file — which the next upload would
    // then delete as "the old logo".
    delete inputData["logo"];

    if (uploadedFilename) {
      inputData["logo"] = uploadedFilename;
    }

    // A-63: who is asking decides WHICH tenant may be changed and WHICH fields.
    // Derived from the authenticated principal, never from the request.
    // It throws for every refusal (400, 403, 404, 409) and for a failed audit
    // insert, all BEFORE the commit — so a throw means nothing was committed
    // and the uploaded file belongs to no tenant.
    result = await tenantService.updateTenant(
      validated.tenantId,
      inputData,
      updatedBy,
      tenantActor(r),
    );
  } catch (err) {
    await discardUploadedLogo(r);
    throw err;
  }

  sendTenantResult(res, result, "Tenant updated successfully", 200);
});

const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate({ ...bodyOf(req), ...req.query }, deleteTenantSchema);
  // A-95: the actor is the authenticated caller — never a body or query
  // `deletedBy` (the schema no longer accepts one; stripUnknown drops it).
  const result = await tenantService.deleteTenant(toTenantId(validated.tenantId), auditActor(req));

  sendTenantResult(res, result, "Tenant deleted successfully", 200);
});

const getTenantSettings = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate({ ...bodyOf(req), ...req.params }, tenantIdSchema);
  const result = await tenantService.getTenantSettings(toTenantId(validated.tenantId));

  sendTenantResult(res, result, "Fetch tenant settings successful", 200);
});

const updateTenantSettings = asyncHandler(async (req: Request, res: Response) => {
  const r = req as TenantRequest;
  const validated = validate({ ...bodyOf(req), ...req.params }, tenantIdSchema);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const settingsData = bodyOf(req) || {};
  const updatedBy = r.user?.id;

  const result = await tenantService.updateTenantSettings(
    toTenantId(validated.tenantId),
    settingsData,
    updatedBy,
    auditPrincipal(req), // A-117: for the audit row written in the transaction; A-282: a key is system:api-key
  );

  sendTenantResult(res, result, "Tenant settings updated successfully", 200);
});

const getTenantUserCount = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate({ ...bodyOf(req), ...req.params }, tenantIdSchema);
  const result = await tenantService.getTenantUserCount(toTenantId(validated.tenantId));

  sendTenantResult(res, result, "Fetch tenant user count successful", 200);
});

const uploadTenantLogo = asyncHandler(async (req: Request, res: Response) => {
  const r = req as TenantRequest;
  const merged: { tenantId?: string } = { ...bodyOf(req), ...req.params };
  const { tenantId } = merged;
  const updatedBy = r.user?.id;

  if (!r.file) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "No file uploaded",
      data: null,
    });
  }

  let result;
  try {
    // A-96: the service audits inside its transaction and throws for every
    // refusal BEFORE the commit — so a throw means the upload belongs to no
    // tenant and must not stay on disk.
    result = await tenantUploadService.updateTenantLogo(
      tenantId,
      r.uploadFilename as string,
      updatedBy,
      tenantActor(r),
    );
  } catch (err) {
    await discardUploadedLogo(r);
    throw err;
  }

  sendTenantResult(res, result, "Tenant logo uploaded successfully", 200);
  return undefined;
});

const removeTenantLogo = asyncHandler(async (req: Request, res: Response) => {
  const r = req as TenantRequest;
  const merged: { tenantId?: string } = { ...bodyOf(req), ...req.params };
  const { tenantId } = merged;
  const updatedBy = r.user?.id;

  const result = await tenantUploadService.removeTenantLogo(
    tenantId,
    updatedBy,
    tenantActor(r),
  );

  sendTenantResult(res, result, "Tenant logo removed successfully", 200);
});

const controller = {
  getAllTenants,
  getSpecificTenant,
  getPublicBranding,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantSettings,
  updateTenantSettings,
  getTenantUserCount,
  uploadTenantLogo,
  removeTenantLogo,
};

export = controller;
