const express = require("express");
const router = express.Router();
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { ROLE_NAMES } = require("../../constants");
const { validate } = require("../../middlewares/validation.middleware");

// A-02. These settings hold the tenant's object-storage credentials (S3 keys,
// NFS paths) and decide where every uploaded file is written. Until 2026-09-23
// they were `auth` alone: any role could read the tenant's bucket credentials
// or repoint storage at a bucket it owned. Tenant-admin only, and never an API
// key — a key must not be able to redirect storage.
const storageAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];
const storageController = require("../../controllers/storage.controller");
const {
  updateStorageSettingsSchema,
} = require("../../validators/storage.validator");

/**
 * @swagger
 * tags:
 *   name: Storage
 *   description: Per-tenant object storage (bring-your-own bucket) + signed downloads
 */

/**
 * @swagger
 * /api/v1/storage/object:
 *   get:
 *     summary: Stream an object from a signed, expiring URL (no auth)
 *     description: >-
 *       Where local/NFS signed download URLs resolve. The key encodes the owning
 *       tenant, and the HMAC token is verified before storage is touched, so a
 *       token for one tenant's key can only ever open that tenant's object.
 *       S3-backed tenants get presigned URLs that never reach this route.
 *     tags: [Storage]
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Object stream }
 *       403: { description: Invalid or expired link }
 *       404: { description: Object not found }
 */
// PUBLIC — token-gated; MUST be registered before the auth'd routes.
router.get("/object", storageController.getObject);

/**
 * @swagger
 * /api/v1/storage/settings:
 *   get:
 *     summary: Get the tenant's storage configuration (secrets redacted)
 *     tags: [Storage]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Storage settings }
 *   put:
 *     summary: Configure the tenant's own storage (health-checked before save)
 *     tags: [Storage]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider: { type: string, enum: [s3, nfs] }
 *               bucket: { type: string }
 *               region: { type: string }
 *               endpoint: { type: string }
 *               accessKeyId: { type: string }
 *               secretAccessKey: { type: string }
 *               root: { type: string }
 *     responses:
 *       200: { description: Storage settings updated }
 *       422: { description: Storage connection test failed }
 *   delete:
 *     summary: Revert the tenant to the platform default storage
 *     tags: [Storage]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Reverted to platform default }
 */
router.get("/settings", ...storageAdmin, storageController.getSettings);
router.put(
  "/settings",
  ...storageAdmin,
  validate(updateStorageSettingsSchema),
  storageController.updateSettings,
);
router.delete("/settings", ...storageAdmin, storageController.clearSettings);

/**
 * @swagger
 * /api/v1/storage/settings/test:
 *   post:
 *     summary: Health-check the tenant's active storage backend
 *     tags: [Storage]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Connection test result }
 */
router.post("/settings/test", ...storageAdmin, storageController.testConnection);

/**
 * @swagger
 * /api/v1/storage/usage:
 *   get:
 *     summary: Report the tenant's total stored bytes/objects (metering input)
 *     tags: [Storage]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Usage retrieved }
 */
router.get("/usage", ...storageAdmin, storageController.getUsage);

module.exports = router;
