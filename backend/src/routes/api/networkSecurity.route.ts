/**
 * Network security (IP allowlist, geofence): `/api/v1/network-security`
 * (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from networkSecurity.route.js. Every route, gate
 * and middleware is in the same order as before, `router.use(auth)` first
 * (checked against the mounted route table). The contract is code-first:
 * networkSecurity.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file
 * carried is gone.
 */
import { Router } from "express";
import networkSecurityController from "../../controllers/networkSecurity.controller";
import { auth, superAdminOnly, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";
import { validateUuid } from "../../middlewares/validateUuid.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

/**
 * A-155: the two reads ran behind a token alone — any role could read its
 * tenant's IP allowlist and geofence, the map of where sign-in is allowed
 * from. They need `network-security: read`. They read the caller's OWN tenant
 * (req.user.tenantId); `checkTenant` additionally answers 404 to a request
 * that names another tenant's id, rather than silently answering for its own.
 */
const canReadNetworkSecurity = dynamicAccess(MENU_SLUGS.NETWORK_SECURITY, "read", {
  checkTenant: true,
});

/**
 * Q-38 (ADR-100): a tenant administrator sets their OWN tenant's allowlist and
 * geofence (`network-security: write`, seeded for the tenant admin role by
 * migration and ROLE_MENU_ASSIGNMENTS). A change that would refuse the
 * caller's own next sign-in is 409 (signInPolicy.service
 * #assertChangeKeepsCaller). The operator acts on any tenant through
 * `/tenants/:tenantId/...` below, where no guard applies. An API key may not
 * change where a tenant signs in from (`denyApiKey`): a leaked key must not be
 * able to widen — or lock — every user's sign-in.
 */
const canWriteNetworkSecurity = dynamicAccess(MENU_SLUGS.NETWORK_SECURITY, "write", {
  checkTenant: true,
});

router.get("/ip-allowlist", canReadNetworkSecurity, networkSecurityController.getIpAllowlist);
router.put("/ip-allowlist", denyApiKey, canWriteNetworkSecurity, networkSecurityController.setIpAllowlist);
router.get("/geofence", canReadNetworkSecurity, networkSecurityController.getGeofence);
router.put("/geofence", denyApiKey, canWriteNetworkSecurity, networkSecurityController.setGeofence);
/**
 * A-179: this route ran behind a token alone. It is NOT a login-time call —
 * no sign-in path calls it (evaluateLoginSecurity has no other caller), and it
 * needs a token, which a signing-in principal does not have yet. It is the
 * network-security screen's "test this IP / location" dry run. Its answer
 * (allowed, the distance to the geofence centre, the radius, the IP verdict)
 * discloses the same policy the two reads above do — and a few calls
 * triangulate the geofence centre — so it takes the same gate:
 * `network-security: read`, checkTenant.
 */
router.post("/evaluate-login", canReadNetworkSecurity, networkSecurityController.evaluateLogin);

// ---------------------------------------------------------------------------
// A-280 (ADR-094) — the platform operator reads and sets a NAMED tenant's
// allowlist and geofence. `PUT /ip-allowlist` and `PUT /geofence` above act on
// the operator's own home tenant. Every change is audited under PLATFORM and
// the tenant; a tenant that does not exist is 404.
// ---------------------------------------------------------------------------

router.get(
  "/tenants/:tenantId/ip-allowlist",
  superAdminOnly,
  validateUuid("tenantId"),
  networkSecurityController.getTenantIpAllowlistFor,
);
router.put(
  "/tenants/:tenantId/ip-allowlist",
  superAdminOnly,
  validateUuid("tenantId"),
  networkSecurityController.setTenantIpAllowlistFor,
);
router.get(
  "/tenants/:tenantId/geofence",
  superAdminOnly,
  validateUuid("tenantId"),
  networkSecurityController.getTenantGeofenceFor,
);
router.put(
  "/tenants/:tenantId/geofence",
  superAdminOnly,
  validateUuid("tenantId"),
  networkSecurityController.setTenantGeofenceFor,
);

export = router;
