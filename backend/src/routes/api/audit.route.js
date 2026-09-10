const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const auditController = require("../../controllers/audit.controller");

/**
 * @swagger
 * /api/v1/audit:
 *   get:
 *     summary: Get audit logs
 *     description: Retrieves paginated, immutable audit logs for the tenant. Required for FDA 21 CFR Part 11 compliance. Requires read access to AuditLogs.
 *     tags: [Audit & Compliance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [CREATE, UPDATE, DELETE, LOGIN, APPROVE, EXPORT]
 *       - in: query
 *         name: resourceType
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 */
// Accept both the model name and the seeded menu identifiers ("Audit Logs"
// name / "audit" slug) — the permission matrix is keyed by menu name AND slug,
// and no menu group is named "AuditLogs".
router.get(
  "/",
  auth,
  dynamicAccess(["AuditLogs", "Audit Logs", "audit"], "read", {
    checkTenant: true,
  }),
  auditController.fetchAuditLogs
);

module.exports = router;
