/**
 * Tenant lifecycle: `/api/v1/tenants/:tenantId/...` (index.js mounts it on
 * `/api/v1/tenants`, beside tenant.route and dataRetention.route).
 *
 * P9-21 (ADR-087): converted from tenantLifecycle.route.js. Every route, gate
 * and middleware is in the same order as before, `router.use(auth)` first
 * (checked against the mounted route table). The contract is code-first:
 * tenantLifecycle.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file
 * carried is gone.
 */
import { Router } from "express";
import tenantLifecycleController from "../../controllers/tenantLifecycle.controller";
import { auth, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

// A-155: this read was gated on a token alone — any role in any tenant could
// read any tenant's lifecycle state (suspended, grace period, offboarding) by
// naming its id. It needs `tenant-lifecycle: read`; `checkTenant` answers 404
// for a tenant id that is not the caller's, as for one that does not exist.
router.get(
  "/:tenantId/status",
  dynamicAccess(MENU_SLUGS.TENANT_LIFECYCLE, "read", { checkTenant: true }),
  tenantLifecycleController.getTenantLifecycleStatus,
);
router.post("/:tenantId/suspend", superAdminOnly, tenantLifecycleController.suspendTenant);
router.post("/:tenantId/resume", superAdminOnly, tenantLifecycleController.resumeTenant);
router.post("/:tenantId/grace-period", superAdminOnly, tenantLifecycleController.enterGracePeriod);
router.post("/:tenantId/offboard", superAdminOnly, tenantLifecycleController.offboardTenant);
router.post("/:tenantId/offboard/cancel", superAdminOnly, tenantLifecycleController.cancelOffboarding);
router.get("/:tenantId/export", superAdminOnly, tenantLifecycleController.exportTenantData);

export = router;
