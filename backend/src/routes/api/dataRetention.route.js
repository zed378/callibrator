const express = require("express");
const router = express.Router();
const dataRetentionController = require("../../controllers/dataRetention.controller");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");

router.use(auth);

/**
 * @swagger
 * /api/v1/tenants/{tenantId}/policy:
 *   get:
 *     summary: Get retention policy
 *     description: Returns the data retention policy for the tenant.
 *     tags: [DataRetention]
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
 *         description: Retention policy returned
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.get("/:tenantId/policy", dataRetentionController.getRetentionPolicy);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/policy:
 *   put:
 *     summary: Set retention policy
 *     description: Sets the data retention policy for the tenant. Super admin only.
 *     tags: [DataRetention]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               policyKey:
 *                 type: string
 *               days:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Retention policy updated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.put("/:tenantId/policy", superAdminOnly, dataRetentionController.setRetentionPolicy);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/legal-hold:
 *   get:
 *     summary: Get legal-hold status
 *     description: Returns the legal-hold status for the tenant.
 *     tags: [DataRetention]
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
 *         description: Legal-hold status returned
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.get("/:tenantId/legal-hold", dataRetentionController.isOnLegalHold);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/legal-hold:
 *   post:
 *     summary: Enable legal hold
 *     description: Enables legal hold for the tenant. Super admin only.
 *     tags: [DataRetention]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Legal hold enabled
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/legal-hold", superAdminOnly, dataRetentionController.enableLegalHold);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/legal-hold:
 *   delete:
 *     summary: Disable legal hold
 *     description: Disables legal hold for the tenant. Super admin only.
 *     tags: [DataRetention]
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
 *         description: Legal hold disabled
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.delete("/:tenantId/legal-hold", superAdminOnly, dataRetentionController.disableLegalHold);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/purge:
 *   post:
 *     summary: Purge expired records
 *     description: Purges expired records for the tenant. Super admin only.
 *     tags: [DataRetention]
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
 *         description: Expired records purged
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/purge", superAdminOnly, dataRetentionController.purgeExpiredRecords);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/mask-pii:
 *   post:
 *     summary: Mask PII fields
 *     description: Masks PII fields for the specified records. Super admin only.
 *     tags: [DataRetention]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               entityType:
 *                 type: string
 *               recordIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: PII fields masked
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/mask-pii", superAdminOnly, dataRetentionController.maskPII);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/anonymize:
 *   post:
 *     summary: Anonymize a dataset
 *     description: Anonymizes a dataset for the tenant. Super admin only.
 *     tags: [DataRetention]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               entityType:
 *                 type: string
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Dataset anonymized
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/anonymize", superAdminOnly, dataRetentionController.anonymizeDataset);

module.exports = router;
