/**
 * @swagger
 * tags:
 *   name: BatchJobs
 *   description: Durable job runner for background tasks
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const {
  createTestJob,
  getJobs,
  getJobStatus,
} = require("../../controllers/batchJob.controller");

router.use(auth);

/**
 * @swagger
 * /api/v1/jobs:
 *   get:
 *     tags: [BatchJobs]
 *     summary: List all background jobs for the tenant
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: List of batch jobs
 */
router.get("/", getJobs);

/**
 * @swagger
 * /api/v1/jobs/{id}:
 *   get:
 *     tags: [BatchJobs]
 *     summary: Get status of a specific background job
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
 *       '200':
 *         description: Job details and progress
 */
router.get("/:id", getJobStatus);

/**
 * @swagger
 * /api/v1/jobs/test:
 *   post:
 *     tags: [BatchJobs]
 *     summary: Create a test background job
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 example: "EXPORT_CSV"
 *               totalItems:
 *                 type: integer
 *                 example: 20
 *     responses:
 *       '201':
 *         description: Job created
 */
router.post("/test", createTestJob);

module.exports = router;
