/**
 * Feature flags: `/api/v1/feature-flags` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from featureFlags.route.js. Every route, gate
 * and middleware is in the same order as before, `router.use(auth)` first
 * (checked against the mounted route table). The contract is code-first:
 * featureFlags.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file
 * carried is gone.
 */
import { Router } from "express";
import featureFlagController from "../../controllers/featureFlag.controller";
import { auth, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

/**
 * A-155: the tenant-flag reads were gated on a token alone, so any role in any
 * tenant could read any tenant's flags by naming its id (in the query for
 * `/`, in the path for `/:tenantId/:flagKey`). Both need `feature-flags:
 * read`; `checkTenant` answers 404 for a tenant id that is not the caller's —
 * path OR query — the same as for one that does not exist.
 */
const canReadFlags = dynamicAccess(MENU_SLUGS.FEATURE_FLAGS, "read", { checkTenant: true });

router.get("/", canReadFlags, featureFlagController.getTenantFlags);
// P6-04: the definitions list backs the feature-flags page only; gate it on
// the same menu as the flags themselves (no tenant in the path, so no checkTenant).
router.get(
  "/definitions",
  dynamicAccess(MENU_SLUGS.FEATURE_FLAGS, "read"),
  featureFlagController.getAllFlagDefinitions,
);
router.get("/:tenantId/:flagKey", canReadFlags, featureFlagController.isFlagEnabled);
// Registered BEFORE the `/:tenantId/:flagKey` param route below — otherwise
// "initialize" is captured as a :flagKey and POST .../initialize is unreachable.
router.post(
  "/:tenantId/initialize",
  superAdminOnly,
  featureFlagController.initializeTenantFlags,
);
router.post("/:tenantId/:flagKey", superAdminOnly, featureFlagController.setTenantFlag);
router.delete("/:tenantId/:flagKey", superAdminOnly, featureFlagController.resetTenantFlag);
export = router;
