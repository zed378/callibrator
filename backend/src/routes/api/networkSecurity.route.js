/**
 * @swagger
 * tags:
 *   name: NetworkSecurity
 *   description: Network Security - IP Allowlist and Geofencing
 */

const express = require("express");
const router = express.Router();
const networkSecurityController = require("../../controllers/networkSecurity.controller");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants/roleConstants");

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

router.get("/ip-allowlist", canReadNetworkSecurity, networkSecurityController.getIpAllowlist);
/**
 * @swagger
 * /api/v1/network-security/ip-allowlist:
 *   put:
 *     summary: Set the IP allowlist
 *     description: Replaces the tenant's CIDR allowlist. Super admin only.
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
router.put("/ip-allowlist", superAdminOnly, networkSecurityController.setIpAllowlist);
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
 *     description: Replaces the tenant's geofence configuration. Super admin only.
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
router.put("/geofence", superAdminOnly, networkSecurityController.setGeofence);
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

module.exports = router;
