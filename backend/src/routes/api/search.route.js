const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const searchController = require("../../controllers/search.controller");
const { SEARCH_MENUS } = require("../../services/search.service");

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
 *       403: { description: The caller may read none of the searchable types }
 */
// A-04. The route was `auth` alone: any authenticated principal could read
// every device, stock item and certificate in the tenant through search.
//
// The gate is OR over every menu a search result can come from, so a caller
// holding `read` on one of them still gets in and the controller then filters
// the result types to the ones that caller may actually read. A caller
// holding none of them is refused here -- and, because this gate runs, an
// API-key principal is authorized by its scopes rather than being blocked by
// the deny-by-default check in controllerWrapper.util (A-03).
router.get(
  "/",
  auth,
  dynamicAccess(SEARCH_MENUS, "read"),
  searchController.search,
);

module.exports = router;
