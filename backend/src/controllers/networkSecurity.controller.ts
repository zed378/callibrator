// P9-20 (ADR-087): converted from networkSecurity.controller.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). The service is the module object; every other
// load-time destructure is kept as a capture at load. The `.js` destructured
// `auth` and `superAdminOnly` from auth.middleware and never used them: the
// module is still loaded here, at the same point (a side-effect import), and
// the unused names are gone.
import type { Request, Response } from "express";

import networkSecurityService from "../services/networkSecurity.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import "../middlewares/auth.middleware";
import {
  ipAllowlistSchema as loadedIpAllowlistSchema,
  geofenceSchema as loadedGeofenceSchema,
  evaluateLoginSchema as loadedEvaluateLoginSchema,
} from "../validators/networkSecurity.validator";
import { validateInput as loadedValidate } from "../validators/input";
// A-282 (ADR-100): a home-tenant change names its principal the one way.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
// Q-38 (ADR-100): a tenant administrator's change may not lock its caller out.
import { assertChangeKeepsCaller as loadedAssertChangeKeepsCaller } from "../services/signInPolicy.service";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const ipAllowlistSchema = loadedIpAllowlistSchema;
const geofenceSchema = loadedGeofenceSchema;
const evaluateLoginSchema = loadedEvaluateLoginSchema;
const validate = loadedValidate;
const auditPrincipal = loadedAuditPrincipal;
const assertChangeKeepsCaller = loadedAssertChangeKeepsCaller;

/** The request as `auth` leaves it; the home tenant is the caller's. */
interface PolicyRequest extends Request {
  user?: { tenantId: TenantId; role?: { name?: string | null; roleLevel?: number | null } | null };
  body: { currentLocation?: unknown } | undefined;
}

/** The target tenant an A-280 route names in its path (`validateUuid("tenantId")`). */
interface TargetParams extends Record<string, string> {
  tenantId: TenantId;
}

/** The caller of a home-tenant change, for the self-lockout guard. */
const policyCaller = (req: PolicyRequest): Parameters<typeof assertChangeKeepsCaller>[1] => ({
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
  ip: req.ip || null,
  currentLocation: req.body?.currentLocation,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.user?.role || null`
  role: req.user?.role || null,
});

const getIpAllowlist = asyncHandler(async (req: Request, res: Response) => {
  const r = req as PolicyRequest;
  const result = await networkSecurityService.getTenantIpAllowlist(r.user?.tenantId as TenantId);
  success(res, { allowlist: result }, null, "Fetch IP allowlist");
});

const setIpAllowlist = asyncHandler(async (req: Request, res: Response) => {
  const r = req as PolicyRequest;
  const validated = validate(r.body, ipAllowlistSchema);
  assertChangeKeepsCaller({ allowlist: validated.cidrs }, policyCaller(r));
  const result = await networkSecurityService.setTenantIpAllowlist(
    r.user?.tenantId as TenantId,
    validated.cidrs,
    auditPrincipal(req),
  );
  success(res, result, null, "IP allowlist updated");
});

const getGeofence = asyncHandler(async (req: Request, res: Response) => {
  const r = req as PolicyRequest;
  const result = await networkSecurityService.getTenantGeofence(r.user?.tenantId as TenantId);
  success(res, { geofence: result }, null, "Fetch geofence");
});

const setGeofence = asyncHandler(async (req: Request, res: Response) => {
  const r = req as PolicyRequest;
  const validated = validate(r.body, geofenceSchema);
  assertChangeKeepsCaller(
    {
      geofence: {
        latitude: validated.latitude,
        longitude: validated.longitude,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a radius of 0 falls back to the default
        radiusKm: validated.radiusKm || networkSecurityService.DEFAULT_GEOFENCE_RADIUS_KM,
      },
    },
    policyCaller(r),
  );
  const result = await networkSecurityService.setTenantGeofence(
    r.user?.tenantId as TenantId,
    validated,
    auditPrincipal(req),
  );
  success(res, result, null, "Geofence updated");
});

// ---------------------------------------------------------------------------
// A-280 (ADR-094) — the operator acting on a tenant they NAME in the path.
// The routes above act on `req.user.tenantId`, which for the super admin (the
// only caller) is always their home tenant: no other tenant's allowlist could
// be set, and nothing named the target. The target is the path, never a body
// and never the x-tenant-id override, and it must exist (404).
// ---------------------------------------------------------------------------

const getTenantIpAllowlistFor = asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as TargetParams;
  await networkSecurityService.assertTenantExists(params.tenantId);
  const result = await networkSecurityService.getTenantIpAllowlist(params.tenantId);
  success(res, { allowlist: result }, null, "Fetch IP allowlist");
});

const setTenantIpAllowlistFor = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.body, ipAllowlistSchema);
  const params = req.params as TargetParams;
  await networkSecurityService.assertTenantExists(params.tenantId);
  const result = await networkSecurityService.setTenantIpAllowlist(params.tenantId, validated.cidrs, auditPrincipal(req));
  success(res, result, null, "IP allowlist updated");
});

const getTenantGeofenceFor = asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as TargetParams;
  await networkSecurityService.assertTenantExists(params.tenantId);
  const result = await networkSecurityService.getTenantGeofence(params.tenantId);
  success(res, { geofence: result }, null, "Fetch geofence");
});

const setTenantGeofenceFor = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.body, geofenceSchema);
  const params = req.params as TargetParams;
  await networkSecurityService.assertTenantExists(params.tenantId);
  const result = await networkSecurityService.setTenantGeofence(params.tenantId, validated, auditPrincipal(req));
  success(res, result, null, "Geofence updated");
});

const evaluateLogin = asyncHandler(async (req: Request, res: Response) => {
  const r = req as PolicyRequest;
  const validated = validate(r.body, evaluateLoginSchema);
  const result = await networkSecurityService.evaluateLoginSecurity(
    r.user?.tenantId as TenantId,
    validated.ip,
    validated.latitude,
    validated.longitude,
  );
  success(res, result, null, "Login security evaluated");
});

const controller = {
  getIpAllowlist,
  setIpAllowlist,
  getGeofence,
  setGeofence,
  getTenantIpAllowlistFor,
  setTenantIpAllowlistFor,
  getTenantGeofenceFor,
  setTenantGeofenceFor,
  evaluateLogin,
};

export = controller;
