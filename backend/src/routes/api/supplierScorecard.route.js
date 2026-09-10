const express = require("express");
const router = express.Router();
const scorecardController = require("../../controllers/supplierScorecard.controller");
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");

router.use(auth);

// Mutations require an interactive user session (scoped API keys are denied).
/**
 * @swagger
 * /api/v1/supplier-scorecard:
 *   post:
 *     summary: Create scorecard
 *     description: Creates a new supplier scorecard. Requires authentication.
 *     tags: [SupplierScorecard]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vendorId
 *               - evaluationDate
 *             properties:
 *               vendorId:
 *                 type: string
 *                 format: uuid
 *               evaluationDate:
 *                 type: string
 *                 format: date
 *               qualityScore:
 *                 type: integer
 *               deliveryScore:
 *                 type: integer
 *               serviceScore:
 *                 type: integer
 *               status:
 *                 type: string
 *               comments:
 *                 type: string
 *               nextEvaluationDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Scorecard created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", denyApiKey, scorecardController.createScorecard);
/**
 * @swagger
 * /api/v1/supplier-scorecard:
 *   get:
 *     summary: List scorecards
 *     description: Returns the tenant's supplier scorecards. Requires authentication.
 *     tags: [SupplierScorecard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Scorecards retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", scorecardController.getScorecards);
/**
 * @swagger
 * /api/v1/supplier-scorecard/{id}:
 *   get:
 *     summary: Get one scorecard
 *     description: Returns a single supplier scorecard by id. Requires authentication.
 *     tags: [SupplierScorecard]
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
 *         description: Scorecard retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Scorecard not found
 */
router.get("/:id", scorecardController.getScorecardById);
/**
 * @swagger
 * /api/v1/supplier-scorecard/{id}:
 *   put:
 *     summary: Update scorecard
 *     description: Updates an existing supplier scorecard. Requires authentication.
 *     tags: [SupplierScorecard]
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
 *               vendorId:
 *                 type: string
 *                 format: uuid
 *               evaluationDate:
 *                 type: string
 *                 format: date
 *               qualityScore:
 *                 type: integer
 *               deliveryScore:
 *                 type: integer
 *               serviceScore:
 *                 type: integer
 *               status:
 *                 type: string
 *               comments:
 *                 type: string
 *               nextEvaluationDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Scorecard updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Scorecard not found
 */
router.put("/:id", denyApiKey, scorecardController.updateScorecard);
/**
 * @swagger
 * /api/v1/supplier-scorecard/{id}:
 *   delete:
 *     summary: Delete scorecard
 *     description: Deletes a supplier scorecard by id. Requires authentication.
 *     tags: [SupplierScorecard]
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
 *         description: Scorecard deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Scorecard not found
 */
router.delete("/:id", denyApiKey, scorecardController.deleteScorecard);

module.exports = router;
