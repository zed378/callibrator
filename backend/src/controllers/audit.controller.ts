/**
 * The audit trail, `/api/v1/audit`.
 *
 * P9-18 (ADR-087): converted from audit.controller.js, behaviour unchanged.
 * `req.user` is read without a guard (`auth` runs first) and the filters are
 * passed raw (the service coerces them). Everything it required at load is
 * captured at load, in its order; the service is read through its module
 * object at call time. `export =` keeps the exact object `require()` returned.
 */
import type { Request, Response } from "express";
import auditService from "../services/audit.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { ACTOR_TYPE_VALUES as LOADED_ACTOR_TYPE_VALUES } from "../constants/systemActors";
// N-01: the one super-admin predicate.
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const AppError = LoadedAppError;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const ACTOR_TYPE_VALUES: readonly string[] = LOADED_ACTOR_TYPE_VALUES;
const isSuperAdminPrincipal = loadedIsSuperAdmin;

/** The principal `auth` set (read without a guard, as before). */
interface AuditPrincipal {
  tenantId: string;
}

/** What `auditService.fetchAuditLogs` answers (the house envelope's parts). */
interface AuditLogPage {
  data: { rows: unknown; meta: object | null };
  message: string;
  status: number;
}

/** The one value `scope` takes: the PLATFORM tenant's trail (A-125). */
const PLATFORM_SCOPE = "platform";

/**
 * @param req
 * @returns whether the authenticated principal is a super admin
 */
const isSuperAdmin = (req: Request): boolean => isSuperAdminPrincipal(req.user);

/**
 * The tenant whose trail is read.
 *
 * The reader's HOME tenant, from the authenticated user only. `scope=platform`
 * reads the PLATFORM tenant's trail instead — platform operations (tenant
 * create and delete, global roles; ADR-051 Q-14) — and only a super admin may
 * ask for it. Anyone else asking is refused with 403: it is a permission
 * failure inside the caller's own tenant, and the PLATFORM tenant's existence
 * is no secret. For anyone but a super admin the tenant hooks would force the
 * caller's own tenant anyway; the 403 says so instead of answering with rows
 * the caller did not ask for.
 *
 * @param req
 * @returns the tenant id
 */
const readableTenantId = (req: Request): string | null => {
  const { scope } = req.query;
  if (scope === undefined || scope === "") {
    return (req.user as AuditPrincipal).tenantId;
  }
  if (scope !== PLATFORM_SCOPE) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: a repeated or nested parameter is interpolated as the JavaScript did
    throw new AppError(400, `Unknown audit scope "${String(scope)}" — the only scope is "${PLATFORM_SCOPE}"`);
  }
  if (!isSuperAdmin(req)) {
    throw new AppError(403, "Only a platform administrator can read the platform audit trail");
  }
  return PLATFORM_TENANT_ID;
};

const fetchAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readableTenantId(req);
  const { page, limit, userId, actorType, action, resourceType, resourceId, startDate, endDate } =
    req.query as Record<string, unknown>;

  // An out-of-ENUM value would reach PostgreSQL as an invalid enum literal (500).
  if (actorType && !ACTOR_TYPE_VALUES.includes(actorType as string)) {
    throw new AppError(400, `actorType must be one of ${ACTOR_TYPE_VALUES.join(", ")}`);
  }

  const result = (await auditService.fetchAuditLogs({
    tenantId,
    page,
    limit,
    userId,
    actorType,
    action,
    resourceType,
    resourceId,
    startDate,
    endDate,
  })) as AuditLogPage;

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

const controller = { fetchAuditLogs };

export = controller;
