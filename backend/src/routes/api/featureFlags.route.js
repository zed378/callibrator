const express = require("express");
const router = express.Router();
const featureFlagController = require("../../controllers/featureFlag.controller");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");

router.use(auth);

/**
 * @swagger
 * /api/v1/feature-flags:
 *   get:
 *     summary: Get effective flags for a tenant
 *     description: Returns the effective feature flags for the specified tenant.
 *     tags: [FeatureFlags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Effective flags returned
 *       401:
 *         description: Unauthorized
 */
router.get("/", featureFlagController.getTenantFlags);
/**
 * @swagger
 * /api/v1/feature-flags/definitions:
 *   get:
 *     summary: Get the flag definitions catalog
 *     description: Returns the catalog of available feature flag definitions.
 *     tags: [FeatureFlags]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Flag definitions returned
 *       401:
 *         description: Unauthorized
 */
router.get("/definitions", featureFlagController.getAllFlagDefinitions);
/**
 * @swagger
 * /api/v1/feature-flags/{tenantId}/{flagKey}:
 *   get:
 *     summary: Check whether a flag is enabled
 *     description: Returns whether the given flag is enabled for the tenant.
 *     tags: [FeatureFlags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: flagKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Flag status returned
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.get("/:tenantId/:flagKey", featureFlagController.isFlagEnabled);
/**
 * @swagger
 * /api/v1/feature-flags/{tenantId}/{flagKey}:
 *   post:
 *     summary: Set a flag override
 *     description: Sets a per-tenant flag override. Super admin only.
 *     tags: [FeatureFlags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: flagKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Flag updated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
// Registered BEFORE the `/:tenantId/:flagKey` param route below — otherwise
// "initialize" is captured as a :flagKey and POST .../initialize is unreachable.
router.post(
  "/:tenantId/initialize",
  superAdminOnly,
  featureFlagController.initializeTenantFlags,
);
router.post("/:tenantId/:flagKey", superAdminOnly, featureFlagController.setTenantFlag);
/**
 * @swagger
 * /api/v1/feature-flags/{tenantId}/{flagKey}:
 *   delete:
 *     summary: Reset a flag to default
 *     description: Resets a per-tenant flag override to its default. Super admin only.
 *     tags: [FeatureFlags]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: flagKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Flag reset to default
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.delete("/:tenantId/:flagKey", superAdminOnly, featureFlagController.resetTenantFlag);
/**
 * @swagger
 * /api/v1/feature-flags/{tenantId}/initialize:
 *   post:
 *     summary: Seed a tenant's default flags
 *     description: Seeds the tenant's default feature flags. Super admin only.
 *     tags: [FeatureFlags]
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
 *         description: Default flags seeded
 *       401:
 *         description: Unauthorized
 */

module.exports = router;
