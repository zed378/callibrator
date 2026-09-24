const express = require("express");
const router = express.Router();
const dataRetentionController = require("../../controllers/dataRetention.controller");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants/roleConstants");

router.use(auth);

/**
 * A-136: the two reads were gated on nothing but a token, so any role in any
 * tenant could read any tenant's retention periods and legal-hold state by
 * naming its id. They now need `data-retention: read` (seeded for the tenant
 * admin roles), and `checkTenant` answers 404 for a tenant id that is not the
 * caller's own — the same as for one that does not exist. The writes below
 * stay super-admin only.
 */
const canReadRetention = dynamicAccess(MENU_SLUGS.DATA_RETENTION, "read", { checkTenant: true });

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
router.get("/:tenantId/policy", canReadRetention, dataRetentionController.getRetentionPolicy);
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
router.get("/:tenantId/legal-hold", canReadRetention, dataRetentionController.isOnLegalHold);
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
 *     summary: Anonymize a dataset (refused)
 *     description: >
 *       A-152 - refused with 400 for every entity type. It overwrote every text
 *       column of every row (for users - password hash, username, email) with
 *       no transaction or audit row. Mask named data subjects with
 *       POST /{tenantId}/mask-pii instead. Super admin only.
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
 *       400:
 *         description: Refused - use mask-pii
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/anonymize", superAdminOnly, dataRetentionController.anonymizeDataset);

module.exports = router;
