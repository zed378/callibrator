/**
 * Vendors (the approved-supplier file): `/api/v1/vendors`.
 *
 * P9-20 (ADR-087): converted from vendor.controller.js, behaviour unchanged.
 * As the JavaScript did: the list passes `req.query` values to the service RAW
 * (no schema); the create, update and qualify bodies are what `validate()` left
 * on `req.body`; the tenant comes from `req.user`, the vendor id from the path;
 * `success()` answers with the service's status (`data: null` on a delete),
 * and qualify answers 200 with the service's result as `data`. Everything the
 * JavaScript destructured at load is still captured at load.
 */
import type { Request, Response } from "express";
import vendorService from "../services/vendor.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;

/**
 * The principal `auth` set. Destructured INLINE from `req.user`, as the
 * JavaScript did: a request without a user throws a TypeError whose message
 * names that expression ("... of 'req.user' as it is undefined"), and the
 * message reaches the client outside production, so it must not change.
 */
interface Principal {
  tenantId: TenantId;
}

/** `:vendorId`, read without a schema (`validateUuid` on the route checked its shape). */
interface VendorParams {
  vendorId: string;
}

/**
 * What reaches the service is what the JavaScript passed: the query values RAW
 * (a repeated key is an array), the body as `validate()` left it. Each call's
 * argument is built as before and only then typed as the service's parameter.
 */
type FetchArg = Parameters<typeof vendorService.fetchVendors>[0];
type QualifyArg = Parameters<typeof vendorService.qualifyVendor>[0];
type VendorBody = Parameters<typeof vendorService.createVendor>[1];
/** The list result's `data` (the JavaScript read `.rows` / `.meta` off it unguarded). */
interface ListData {
  rows: unknown;
  meta: object;
}

/** The qualify body as `validate(qualifyVendor)` leaves it (read with `|| {}`, as before). */
interface QualifyBody {
  approvalStatus?: unknown;
  scorecard?: unknown;
  lastAuditDate?: unknown;
  nextAuditDate?: unknown;
}

export const fetchVendors = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { find, page, limit, status, type } = req.query;

  const query = {
    tenantId,
    find,
    page,
    limit,
    status,
    type,
  };
  const result = await vendorService.fetchVendors(query as FetchArg);

  success(res, (result.data as ListData).rows, (result.data as ListData).meta, result.message, result.status);
});

export const getVendorById = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { vendorId } = req.params as unknown as VendorParams;

  const result = await vendorService.getVendorById(tenantId, vendorId);
  success(res, result.data, null, result.message, result.status);
});

export const createVendor = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const data = req.body as VendorBody;

  const result = await vendorService.createVendor(tenantId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

export const updateVendor = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { vendorId } = req.params as unknown as VendorParams;
  const data = req.body as VendorBody;

  const result = await vendorService.updateVendor(tenantId, vendorId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

export const deleteVendor = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { vendorId } = req.params as unknown as VendorParams;

  const result = await vendorService.deleteVendor(tenantId, vendorId, auditPrincipal(req));
  success(res, null, null, result.message, result.status);
});

export const qualifyVendor = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { vendorId } = req.params as unknown as VendorParams;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { approvalStatus, scorecard, lastAuditDate, nextAuditDate } = (req.body as QualifyBody | undefined) || {};

  const input = {
    tenantId,
    id: vendorId,
    approvalStatus,
    scorecard,
    lastAuditDate,
    nextAuditDate,
    actor: auditPrincipal(req),
  };
  const result = await vendorService.qualifyVendor(input as QualifyArg);

  success(res, result, null, "Vendor qualification updated", 200);
});
