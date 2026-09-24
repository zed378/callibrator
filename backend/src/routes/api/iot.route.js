const express = require("express");
const router = express.Router();
const iotController = require("../../controllers/iot.controller");
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { endpointRateLimiter } = require("../../services/rateLimiter.redis.service");
const { ROLE_NAMES } = require("../../constants");

// A-29: ingest is unauthenticated until the token is checked, so it is
// limited per client address (the device principal is unknown at this point).
const ingestLimiter = endpointRateLimiter("iotIngest", {
  byUser: false,
  byToken: false,
  maxRequests: 600,
  windowMs: 60 * 1000,
});

// A-29 / A-46: provisioning — issuing, rotating and revoking an ingest token,
// and setting iotEnabled / readingTolerance — is a tenant-administrator act
// with calibration write access, JWT-only (an API key cannot mint device
// credentials). Reading the provisioning state needs calibration read.
const readGate = [auth, validateUuid("deviceId"), dynamicAccess("calibration", "read")];
const adminGate = [
  auth,
  denyApiKey,
  validateUuid("deviceId"),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("calibration", "write"),
];

// HTTP Ingestion endpoint
// POST /api/v1/iot/ingest
/**
 * @swagger
 * /api/v1/iot/ingest:
 *   post:
 *     summary: Ingest device telemetry
 *     description: Ingests device telemetry readings. Public endpoint authenticated via device token in the x-iot-token header (not bearerAuth).
 *     tags: [IoT]
 *     parameters:
 *       - in: header
 *         name: x-iot-token
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Telemetry ingested successfully
 *       400:
 *         description: Validation error
 */
router.post("/ingest", ingestLimiter, iotController.ingestHttp);

/**
 * @swagger
 * /api/v1/iot/devices/{deviceId}:
 *   get:
 *     summary: A device's IoT provisioning state
 *     description: iotEnabled, readingTolerance, whether a token exists and when it was issued. Never the token or its hash. Another tenant's device is 404.
 *     tags: [IoT]
 *     parameters:
 *       - { in: path, name: deviceId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The provisioning state }
 *       404: { description: Not found (including another tenant's device) }
 *   patch:
 *     summary: Enable/disable ingest and set the reading tolerance
 *     description: 'Tenant admin. Body { iotEnabled?, readingTolerance? } where readingTolerance is { metric: { min?, max? } } or null. Enabling a device with no token is 409.'
 *     tags: [IoT]
 *     parameters:
 *       - { in: path, name: deviceId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Validation error }
 *       404: { description: Not found }
 *       409: { description: No token — issue one first }
 */
router.get("/devices/:deviceId", ...readGate, iotController.getDeviceIotConfig);
router.patch("/devices/:deviceId", ...adminGate, iotController.updateDeviceIotConfig);

/**
 * @swagger
 * /api/v1/iot/devices/{deviceId}/token:
 *   post:
 *     summary: Issue or rotate the device's ingest token
 *     description: Tenant admin. Returns the token ONCE (data.token); only its SHA-256 hash is stored. Rotating invalidates the previous token. Enables ingest.
 *     tags: [IoT]
 *     parameters:
 *       - { in: path, name: deviceId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Issued — the token is in this response only }
 *       404: { description: Not found }
 *   delete:
 *     summary: Revoke the device's ingest token and disable ingest
 *     tags: [IoT]
 *     parameters:
 *       - { in: path, name: deviceId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Revoked }
 *       404: { description: Not found }
 *       409: { description: No token to revoke }
 */
router.post("/devices/:deviceId/token", ...adminGate, iotController.issueDeviceToken);
router.delete("/devices/:deviceId/token", ...adminGate, iotController.revokeDeviceToken);

module.exports = router;
