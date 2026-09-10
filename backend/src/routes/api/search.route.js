const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const searchController = require("../../controllers/search.controller");

/**
 * @swagger
 * /api/v1/search:
 *   get:
 *     summary: Unified tenant-scoped full-text search (devices, stock, certificates)
 *     description: >-
 *       Postgres full-text search ranked by relevance, falling back to ILIKE
 *       where FTS is unavailable. Scoped to the caller's tenant.
 *     tags: [Search]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: types
 *         schema: { type: string }
 *         description: Comma-separated subset of device,stock,certificate.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: Search results }
 */
router.get("/", auth, searchController.search);

module.exports = router;
