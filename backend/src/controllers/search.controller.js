// src/controllers/search.controller.js
const searchService = require("../services/search.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

// GET /api/v1/search?q=&types=device,stock&limit=
exports.search = asyncHandler(async (req, res) => {
  const types = req.query.types
    ? String(req.query.types)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    : undefined;

  const data = await searchService.search(req.user.tenantId, {
    q: req.query.q,
    types,
    limit: req.query.limit,
  });

  success(res, data, null, "Search results", 200);
});
