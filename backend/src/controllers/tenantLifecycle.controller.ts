// P9-20 (ADR-087): converted from tenantLifecycle.controller.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). The service is the module object; every other
// load-time destructure is kept as a capture at load. The `.js` also
// destructured `error` and never used it; that unused name is gone.
// A validated tenant id becomes a `TenantId` through `toTenantId`, which cannot
// throw here: `z.guid()` has already accepted exactly the shape it checks.
import type { Request, Response } from "express";

import tenantLifecycleService from "../services/tenantLifecycle.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import {
  tenantIdSchema as loadedTenantIdSchema,
  suspendTenantSchema as loadedSuspendTenantSchema,
} from "../validators/tenantLifecycle.validator";
import { validateInput as loadedValidate } from "../validators/input";
// A-273: the path names the resource — path params win, a differing body id is 400.
import { withPathParams as loadedWithPathParams } from "../utils/pathParams.util";
import { withoutRedactedSettings as loadedWithoutRedactedSettings } from "../constants/tenantSecretSettings";
import { toTenantId } from "../types/ids";
import type { UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditActor = loadedAuditActor;
const tenantIdSchema = loadedTenantIdSchema;
const suspendTenantSchema = loadedSuspendTenantSchema;
const validate = loadedValidate;
const withPathParams = loadedWithPathParams;
const withoutRedactedSettings = loadedWithoutRedactedSettings;

/** The caller `auth` put on the request. */
interface Caller {
  id?: UserId | null;
}

/** A tenant row, or the plain object a caller (or a test double) passes. */
interface TenantLike {
  toJSON?: () => object;
  settings?: unknown;
}

/**
 * A-263 — a Tenant row as a lifecycle response carries it: plain, and without
 * any credential mirrored into its `settings` JSONB (the A-179 rule, which
 * GET /tenant-lifecycle/:tenantId/export already follows). The services return
 * the instance because their internal callers (the grace-period scheduler)
 * want one; the redaction belongs where the row leaves the server.
 *
 * @param {object|null} tenant - a Tenant instance or plain row
 * @returns {object|null}
 */
const tenantBody = (tenant: TenantLike | null | undefined): Record<string, unknown> | null | undefined => {
  if (!tenant) {
    return tenant;
  }
  const plain = (typeof tenant.toJSON === "function" ? tenant.toJSON() : { ...tenant }) as Record<string, unknown>;
  if (plain["settings"] !== undefined) {
    plain["settings"] = withoutRedactedSettings(plain["settings"]);
  }
  return plain;
};

/** The path parameters, which on these routes are all `:param` strings. */
const paramsOf = (req: Request): Record<string, string> => req.params as Record<string, string>;

const suspendTenant = asyncHandler(async (req: Request, res: Response) => {
  // tenantId comes from the path (:tenantId); the body carries { reason }.
  // Merged so a correctly-formed call (id in path, reason in body) validates;
  // A-273: the path wins, and a body naming another tenant is 400.
  const validated = validate(withPathParams(paramsOf(req), req.body as Record<string, unknown> | undefined), suspendTenantSchema);
  const result = await tenantLifecycleService.suspendTenant(
    toTenantId(validated.tenantId),
    validated.reason,
    (req.user as Caller | undefined)?.id,
    auditActor(req),
  );

  success(res, tenantBody(result), null, "Tenant suspended");
});

const resumeTenant = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.resumeTenant(
    toTenantId(validated.tenantId),
    (req.user as Caller | undefined)?.id,
    auditActor(req),
  );

  success(res, tenantBody(result), null, "Tenant resumed");
});

const enterGracePeriod = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.enterGracePeriod(toTenantId(validated.tenantId), auditActor(req));

  success(res, tenantBody(result), null, "Tenant entered grace period");
});

const offboardTenant = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  // The operator is the audit row's actor (W-04); without one it would be
  // recorded as the scheduler. Not auditActor's tenantId: the row belongs to
  // the tenant being offboarded, not to the operator's home tenant.
  const { userId, ipAddress, userAgent } = auditActor(req);
  const result = await tenantLifecycleService.offboardTenant(
    toTenantId(validated.tenantId),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `force || false`
    (validated as { force?: unknown }).force || false,
    { userId, ipAddress, userAgent },
  );

  // offboardTenant answers { tenant } (W-17), or the row itself when the
  // tenant was already offboarded and force was not given.
  const answer = result as { tenant?: TenantLike } | null;
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `result && result.tenant`
  const offboarded = answer && answer.tenant ? { ...answer, tenant: tenantBody(answer.tenant) } : tenantBody(result as TenantLike);
  success(res, offboarded, null, "Tenant offboarded");
});

const cancelOffboarding = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.cancelOffboarding(toTenantId(validated.tenantId), auditActor(req));

  success(res, tenantBody(result), null, "Offboarding cancelled");
});

const getTenantLifecycleStatus = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.getTenantLifecycleStatus(toTenantId(validated.tenantId));

  success(res, result, null, "Fetch lifecycle status successful");
});

const exportTenantData = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.exportTenantData(toTenantId(validated.tenantId));

  success(res, result, null, "Tenant data exported");
});

const controller = {
  suspendTenant,
  resumeTenant,
  enterGracePeriod,
  offboardTenant,
  cancelOffboarding,
  getTenantLifecycleStatus,
  exportTenantData,
};

export = controller;
