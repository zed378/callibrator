/**
 * @swagger
 * tags:
 *   name: Workflows
 *   description: Custom approval workflow engine — dynamic approval chains for certificates, stock transfers, and maintenance work orders
 */

const express = require("express");
const router = express.Router();
const workflowController = require("../../controllers/workflow.controller");
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const {
  createWorkflowSchema,
  updateWorkflowSchema,
  submitActionSchema,
} = require("../../validators/workflow.validator");

// User action routes (Inbox) - requires basic user read access to something, or a new 'workflow' menu.
// Assuming 'workflow' is a new menu slug for Workflow Management

/**
 * @swagger
 * /api/v1/workflows/instances/pending:
 *   get:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: List workflow instances awaiting the current user's approval
 *     description: Returns pending workflow instances whose current step requires the authenticated user's role.
 *     responses:
 *       200:
 *         description: Pending approval tasks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/instances/pending",
  auth,
  workflowController.getPendingTasks
);

/**
 * @swagger
 * /api/v1/workflows/instances/{instanceId}/action:
 *   post:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: Approve or reject the current step of a workflow instance
 *     parameters:
 *       - in: path
 *         name: instanceId
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
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               comments:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Action recorded; instance advances, completes, or is rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid payload or instance not pending
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: User's role cannot approve the current step
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Workflow instance not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/instances/:instanceId/action",
  auth,
  validateUuid("instanceId"),
  validate(submitActionSchema),
  workflowController.submitAction
);

// Admin Management Routes

/**
 * @swagger
 * /api/v1/workflows:
 *   get:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: List workflows for the tenant (with steps)
 *     responses:
 *       200:
 *         description: Workflows retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - requires workflow read permission
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/",
  auth,
  dynamicAccess("workflow", "read"),
  workflowController.getWorkflows
);

/**
 * @swagger
 * /api/v1/workflows:
 *   post:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: Create a workflow (deactivates any existing active workflow for the same resource type)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, resourceType, steps]
 *             properties:
 *               name:
 *                 type: string
 *               resourceType:
 *                 type: string
 *                 enum: [Certificate, StockTransfer, MaintenanceWorkOrder]
 *               isActive:
 *                 type: boolean
 *               steps:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [stepOrder, roleId]
 *                   properties:
 *                     stepOrder:
 *                       type: integer
 *                       minimum: 1
 *                     roleId:
 *                       type: string
 *                       format: uuid
 *                     requiredApprovals:
 *                       type: integer
 *                       minimum: 1
 *     responses:
 *       201:
 *         description: Workflow created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - requires workflow write permission
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/",
  auth,
  dynamicAccess("workflow", "write"),
  validate(createWorkflowSchema),
  workflowController.createWorkflow
);

/**
 * @swagger
 * /api/v1/workflows/{id}:
 *   get:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: Get one workflow with its steps
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Workflow retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Workflow not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id",
  auth,
  dynamicAccess("workflow", "read"),
  validateUuid("id"),
  workflowController.getWorkflowById
);

/**
 * @swagger
 * /api/v1/workflows/{id}:
 *   put:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: Update a workflow (name, active flag, or full steps replacement)
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
 *               name:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               steps:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [stepOrder, roleId]
 *                   properties:
 *                     stepOrder:
 *                       type: integer
 *                       minimum: 1
 *                     roleId:
 *                       type: string
 *                       format: uuid
 *                     requiredApprovals:
 *                       type: integer
 *                       minimum: 1
 *     responses:
 *       200:
 *         description: Workflow updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Workflow not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put(
  "/:id",
  auth,
  dynamicAccess("workflow", "write"),
  validateUuid("id"),
  validate(updateWorkflowSchema),
  workflowController.updateWorkflow
);

/**
 * @swagger
 * /api/v1/workflows/{id}:
 *   delete:
 *     tags: [Workflows]
 *     security:
 *       - bearerAuth: []
 *     summary: Delete a workflow
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Workflow deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Workflow not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete(
  "/:id",
  auth,
  dynamicAccess("workflow", "write"),
  validateUuid("id"),
  workflowController.deleteWorkflow
);

module.exports = router;
