/**
 * @swagger
 * tags:
 *   name: NetworkSecurity
 *   description: Network Security - IP Allowlist and Geofencing
 */

const express = require("express");
const router = express.Router();
const networkSecurityController = require("../../controllers/networkSecurity.controller");
const { auth, superAdminOnly, denyApiKey } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants/roleConstants");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");

router.use(auth);

/**
 * @swagger
 * /api/v1/network-security/ip-allowlist:
 *   get:
 *     summary: Get the IP allowlist
 *     description: Returns the tenant's CIDR allowlist.
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The current CIDR allowlist
 *       401:
 *         description: Unauthorized
 */
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
/**
 * @swagger
 * /api/v1/network-security/ip-allowlist:
 *   put:
 *     summary: Set the IP allowlist
 *     description: >-
 *       Replaces the caller's own tenant's CIDR allowlist (network-security write;
 *       a tenant administrator since Q-38, ADR-100). Enforced at every sign-in
 *       (A-288). 409 SELF_LOCKOUT when the list does not contain the address the
 *       change is made from (a platform operator is exempt).
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cidrs:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Allowlist updated
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 */
router.put("/ip-allowlist", denyApiKey, canWriteNetworkSecurity, networkSecurityController.setIpAllowlist);
/**
 * @swagger
 * /api/v1/network-security/geofence:
 *   get:
 *     summary: Get the geofence configuration
 *     description: Returns the tenant's geofence configuration.
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The current geofence configuration
 *       401:
 *         description: Unauthorized
 */
router.get("/geofence", canReadNetworkSecurity, networkSecurityController.getGeofence);
/**
 * @swagger
 * /api/v1/network-security/geofence:
 *   put:
 *     summary: Set the geofence configuration
 *     description: >-
 *       Replaces the caller's own tenant's geofence (network-security write; a
 *       tenant administrator since Q-38, ADR-100). The body must also carry
 *       `currentLocation: { latitude, longitude }` inside the new fence, else
 *       409 SELF_LOCKOUT (a platform operator is exempt). Enforced at password,
 *       MFA and passkey sign-ins from a device-reported location (A-288).
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               radiusKm:
 *                 type: number
 *     responses:
 *       200:
 *         description: Geofence updated
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 */
router.put("/geofence", denyApiKey, canWriteNetworkSecurity, networkSecurityController.setGeofence);
/**
 * @swagger
 * /api/v1/network-security/evaluate-login:
 *   post:
 *     summary: Evaluate an IP and location at login
 *     description: Evaluates a given IP address and location against the tenant's network security policies.
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ip:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Evaluation result
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Missing the network-security read permission
 */
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

/**
 * @swagger
 * /api/v1/network-security/tenants/{tenantId}/ip-allowlist:
 *   get:
 *     summary: Get a tenant's IP allowlist (super admin)
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The tenant's CIDR allowlist
 *       404:
 *         description: Tenant not found
 *   put:
 *     summary: Set a tenant's IP allowlist (super admin)
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: IP allowlist updated
 *       404:
 *         description: Tenant not found
 */
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
/**
 * @swagger
 * /api/v1/network-security/tenants/{tenantId}/geofence:
 *   get:
 *     summary: Get a tenant's geofence (super admin)
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The tenant's geofence, or null
 *       404:
 *         description: Tenant not found
 *   put:
 *     summary: Set a tenant's geofence (super admin)
 *     tags: [NetworkSecurity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Geofence updated
 *       404:
 *         description: Tenant not found
 */
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

module.exports = router;
