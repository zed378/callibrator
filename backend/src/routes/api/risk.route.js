const express = require("express");
const router = express.Router();
const riskController = require("../../controllers/risk.controller");
const { auth } = require("../../middlewares/auth.middleware");

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
router.post("/", riskController.createRisk);
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
router.get("/", riskController.getRisks);
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
router.get("/:id", riskController.getRiskById);
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
router.put("/:id", riskController.updateRisk);
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
router.delete("/:id", riskController.deleteRisk);

module.exports = router;
