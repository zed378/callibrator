const express = require("express");
const router = express.Router();
const riskController = require("../../controllers/risk.controller");
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants");

// A-28 — authorization.
//
// Until 2026-09-23 every route here carried `auth` alone and risk.service
// checked tenant only, so any role could create, rescore or delete entries in
// the risk register (ISO 14971 / ISO 13485 risk management file).
//
// `risk` is a real MENU_SLUGS entry: write is held by SUPERADMIN, HEALTHCARE
// ADMIN and CALIBRATOR ADMIN; ENGINEERING MANAGER holds read. No other seeded
// role holds the menu at all, so a TECHNICIAN or USER now gets 403 on every
// route here — including the reads, which is what the menu matrix says.
router.use(auth);

/**
 * @swagger
 * /api/v1/risk:
 *   post:
 *     summary: Create risk
 *     description: Creates a new risk in the tenant's risk register. Requires authentication.
 *     tags: [Risk]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               severity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               likelihood:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               mitigationPlan:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *                 format: uuid
 *               dueDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Risk created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", dynamicAccess(MENU_SLUGS.RISK, "write"), riskController.createRisk);
/**
 * @swagger
 * /api/v1/risk:
 *   get:
 *     summary: List risks
 *     description: Returns the tenant's risk register. Requires authentication.
 *     tags: [Risk]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Risks retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", dynamicAccess(MENU_SLUGS.RISK, "read"), riskController.getRisks);
/**
 * @swagger
 * /api/v1/risk/{id}:
 *   get:
 *     summary: Get one risk
 *     description: Returns a single risk by id. Requires authentication.
 *     tags: [Risk]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Risk retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Risk not found
 */
router.get("/:id", dynamicAccess(MENU_SLUGS.RISK, "read"), riskController.getRiskById);
/**
 * @swagger
 * /api/v1/risk/{id}:
 *   put:
 *     summary: Update risk
 *     description: Updates an existing risk. Requires authentication.
 *     tags: [Risk]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               severity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               likelihood:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               mitigationPlan:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *                 format: uuid
 *               dueDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Risk updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Risk not found
 */
router.put("/:id", dynamicAccess(MENU_SLUGS.RISK, "write"), riskController.updateRisk);
/**
 * @swagger
 * /api/v1/risk/{id}:
 *   delete:
 *     summary: Delete risk
 *     description: Deletes a risk by id. Requires authentication.
 *     tags: [Risk]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Risk deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Risk not found
 */
router.delete("/:id", dynamicAccess(MENU_SLUGS.RISK, "write"), riskController.deleteRisk);

module.exports = router;
