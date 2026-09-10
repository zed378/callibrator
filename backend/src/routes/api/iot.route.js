const express = require("express");
const router = express.Router();
const iotController = require("../../controllers/iot.controller");

// HTTP Ingestion endpoint
// POST /api/v1/iot/ingest
/**
 * @swagger
 * /api/v1/iot/ingest:
 *   post:
 *     summary: Ingest device telemetry
 *     description: Ingests device telemetry readings. Public endpoint authenticated via device token in the x-iot-token header (not bearerAuth).
 *     tags: [IoT]
 *     parameters:
 *       - in: header
 *         name: x-iot-token
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Telemetry ingested successfully
 *       400:
 *         description: Validation error
 */
router.post("/ingest", iotController.ingestHttp);

module.exports = router;
