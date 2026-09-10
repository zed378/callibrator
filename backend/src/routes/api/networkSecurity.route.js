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
router.get("/ip-allowlist", networkSecurityController.getIpAllowlist);
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
router.get("/geofence", networkSecurityController.getGeofence);
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
 */
router.post("/evaluate-login", networkSecurityController.evaluateLogin);

module.exports = router;
