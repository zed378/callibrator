const express = require("express");
const router = express.Router();
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { ROLE_NAMES } = require("../../constants");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { requireFeature } = require("../../middlewares/enforceQuota.middleware");

// A-02. A webhook is an outbound channel out of the tenant: its target URL
// decides where this tenant's data is POSTed, and its secret signs it. Until
// 2026-09-23 every route here was `auth` alone, so any role — a room user —
// could point a webhook at a host it controls and read the tenant's events.
// Managing them is tenant-admin work, and never an API key's (a scoped key
// could otherwise widen its own reach into an exfiltration channel).
const webhookAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];
const webhookController = require("../../controllers/webhook.controller");

/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: Outbound webhook subscriptions + delivery log
 */

/**
 * @swagger
 * /api/v1/webhooks:
 *   post:
 *     summary: Register a webhook (plan feature "webhooks")
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, events]
 *             properties:
 *               url: { type: string, format: uri }
 *               events:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["certificate.signed", "device.overdue", "*"]
 *               description: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       201: { description: Webhook created (secret returned once) }
 *       402: { description: Feature not available on the current plan }
 */
router.post("/", ...webhookAdmin, requireFeature("webhooks"), webhookController.create);

/**
 * @swagger
 * /api/v1/webhooks:
 *   get:
 *     summary: List webhooks (secrets never returned)
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *     responses:
 *       200: { description: Webhooks retrieved }
 */
router.get("/", ...webhookAdmin, webhookController.list);

/**
 * @swagger
 * /api/v1/webhooks/{id}:
 *   get:
 *     summary: Get one webhook (public fields only, no secret)
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Webhook retrieved }
 *       404: { description: Webhook not found }
 */
router.get("/:id", ...webhookAdmin, validateUuid("id"), webhookController.getOne);

/**
 * @swagger
 * /api/v1/webhooks/{id}:
 *   patch:
 *     summary: Update a webhook (url, events, description, isActive)
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, format: uri }
 *               events:
 *                 type: array
 *                 items: { type: string }
 *               description: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Webhook updated }
 *       404: { description: Webhook not found }
 */
router.patch("/:id", ...webhookAdmin, validateUuid("id"), webhookController.update);

/**
 * @swagger
 * /api/v1/webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook (soft-delete)
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Webhook deleted }
 *       404: { description: Webhook not found }
 */
router.delete("/:id", ...webhookAdmin, validateUuid("id"), webhookController.remove);

/**
 * @swagger
 * /api/v1/webhooks/{id}/deliveries:
 *   get:
 *     summary: List delivery attempts for a webhook
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deliveries retrieved }
 */
router.get("/:id/deliveries", ...webhookAdmin, validateUuid("id"), webhookController.deliveries);

/**
 * @swagger
 * /api/v1/webhooks/{id}/test:
 *   post:
 *     summary: Send a synthetic test delivery to a webhook
 *     tags: [Webhooks]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Test delivery attempted }
 */
router.post("/:id/test", ...webhookAdmin, validateUuid("id"), webhookController.test);

module.exports = router;
