/**
 * The platform operator's console: `/api/v1/admin` (index.js mounts it).
 * Super admin only (this router's rbac).
 *
 * P9-21 (ADR-087): converted from admin.route.js. Every route, gate and
 * middleware is in the same order as before, `router.use(auth)` and the rbac
 * first (checked against the mounted route table). The contract is
 * code-first: admin.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this
 * file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { getAllTenants, updateTenantStatus, updateTenantFlags } from "../../controllers/admin.controller";
import { validate } from "../../middlewares/validation.middleware";
import { updateTenantFlagsSchema } from "../../validators/admin.validator";
// P10-04 / P10-05 / P10-07 (ADR-098): TypeScript controllers and validators.
import { list as listAccessRequests, erase as eraseAccessRequests, detail as getAccessRequest, approve as approveAccessRequest, reject as rejectAccessRequest, resendInvitation as resendAccessRequestInvitation } from "../../controllers/accessRequest.controller";
import { tenantIdParamsSchema, getDomains as getSsoDomains, putDomains as putSsoDomains } from "../../controllers/ssoDomains.controller";
import { listAccessRequestsSchema, accessRequestIdSchema, approveAccessRequestSchema, rejectAccessRequestSchema, eraseAccessRequestsSchema } from "../../validators/accessRequest.validator";
import { ssoEmailDomainsSchema } from "../../validators/publicAuth.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

// All admin routes require SUPER_ADMIN role
router.use(auth);
router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]));

router.get("/tenants", getAllTenants);

router.patch("/tenants/:id/status", updateTenantStatus);

// A-174: `flags` is a plain object of flag keys to scalar values, and never a
// secret-named key (validators/admin.validator.js).
router.patch("/tenants/:id/flags", validate(updateTenantFlagsSchema), updateTenantFlags);

// ---------------------------------------------------------------------------
// P10-04 (ADR-098 §7.2) — a tenant's SSO email-domain claim, read by the
// public identifier-first discovery. Platform-controlled: super admin only
// (this router's rbac), never a tenant setting a tenant can write.
// Contract: accessRequestAdmin.openapi.ts.
// ---------------------------------------------------------------------------
router.get("/tenants/:id/sso-domains", validate(tenantIdParamsSchema, { from: "params" }), getSsoDomains);
router.put(
  "/tenants/:id/sso-domains",
  validate(ssoEmailDomainsSchema, { from: ["params", "body"] }),
  putSsoDomains,
);

// ---------------------------------------------------------------------------
// P10-05 / P10-07 (ADR-098 §6) — the access-request queue. Super admin only
// (this router's rbac): approving creates a tenant, a platform operation
// (A-76). The table has no tenant; the :id routes are allow-listed as
// `platform` in the two-tenant guard. Contract: accessRequestAdmin.openapi.ts.
// ---------------------------------------------------------------------------
router.get("/access-requests", validate(listAccessRequestsSchema, { from: "query" }), listAccessRequests);
router.post("/access-requests/erasure", validate(eraseAccessRequestsSchema), eraseAccessRequests);
router.get("/access-requests/:id", validate(accessRequestIdSchema, { from: "params" }), getAccessRequest);
router.post(
  "/access-requests/:id/approve",
  validate(approveAccessRequestSchema, { from: ["params", "body"] }),
  approveAccessRequest,
);
router.post(
  "/access-requests/:id/reject",
  validate(rejectAccessRequestSchema, { from: ["params", "body"] }),
  rejectAccessRequest,
);
router.post(
  "/access-requests/:id/resend-invitation",
  validate(accessRequestIdSchema, { from: "params" }),
  resendAccessRequestInvitation,
);

export = router;
