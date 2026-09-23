const express = require("express");
const router = express.Router();
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { ROLE_NAMES } = require("../../constants");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { requireFeature } = require("../../middlewares/enforceQuota.middleware");
const apiKeyController = require("../../controllers/apiKey.controller");

// Managing API keys is JWT-only (denyApiKey) so a scoped service account can
// never mint or revoke keys — that would be a privilege-escalation path.
//
// It is also TENANT_ADMIN-only (A-27). Until 2026-09-23 any authenticated
// user could mint a key with any scopes it named, and SCIM accepts any API
// key as a service account — so the lowest-privilege account could issue
// itself a "*" key and provision a SUPERADMIN user with it.
const adminOnly = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];

/**
 * @swagger
 * tags:
 *   name: API Keys
 *   description: Tenant-scoped API keys / service accounts
 */

/**
 * @swagger
 * /api/v1/api-keys:
 *   post:
 *     summary: Create an API key (plan feature "api_keys"; returns the key once)
 *     tags: [API Keys]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, scopes]
 *             properties:
 *               name: { type: string }
 *               scopes:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["CalibrationDevices:read", "Certificates:read"]
 *               expiresAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: API key created (key returned once) }
 *       402: { description: Feature not available on the current plan }
 */
router.post("/", ...adminOnly, requireFeature("api_keys"), apiKeyController.create);

/**
 * @swagger
 * /api/v1/api-keys:
 *   get:
 *     summary: List API keys (secrets never returned)
 *     tags: [API Keys]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *     responses:
 *       200: { description: API keys retrieved }
 */
router.get("/", ...adminOnly, apiKeyController.list);

/**
 * @swagger
 * /api/v1/api-keys/{id}:
 *   get:
 *     summary: Get one API key (public fields only, no secret)
 *     tags: [API Keys]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: API key retrieved }
 *       404: { description: API key not found }
 */
router.get("/:id", ...adminOnly, validateUuid("id"), apiKeyController.getOne);

/**
 * @swagger
 * /api/v1/api-keys/{id}:
 *   delete:
 *     summary: Revoke an API key (deactivates and soft-deletes)
 *     tags: [API Keys]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: API key revoked }
 *       404: { description: API key not found }
 */
router.delete("/:id", ...adminOnly, validateUuid("id"), apiKeyController.revoke);

module.exports = router;
