const riskService = require("../services/risk.service");
const { success } = require("../utils/response.util");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");

exports.createRisk = asyncHandlerWithMapping(
  async (req, res) => {
    const data = await riskService.createRisk(req.user.tenantId, req.body, req.user.id);
    success(res, data, null, "Risk created successfully", 201);
  },
  {}
);

exports.getRisks = asyncHandlerWithMapping(
  async (req, res) => {
    // House style: rows go in `data` (a top-level array) and pagination in the
    // `meta` sibling. Previously the whole { rows, total, ... } object sat in
    // `data`, so the frontend (which reads `data` as an array) always rendered
    // an empty list and lost pagination.
    const { rows, total, page, totalPages } = await riskService.getRisks(
      req.user.tenantId,
      req.query,
    );
    const limit = parseInt(req.query.limit, 10) || 10;
    success(res, rows, { total, page, limit, totalPages }, "Risks retrieved successfully", 200);
  },
  {}
);

exports.getRiskById = asyncHandlerWithMapping(
  async (req, res) => {
    const data = await riskService.getRiskById(req.user.tenantId, req.params.id);
    success(res, data, null, "Risk retrieved successfully", 200);
  },
  {
    "Risk not found": 404,
  }
);

exports.updateRisk = asyncHandlerWithMapping(
  async (req, res) => {
    const data = await riskService.updateRisk(req.user.tenantId, req.params.id, req.body);
    success(res, data, null, "Risk updated successfully", 200);
  },
  {
    "Risk not found": 404,
  }
);

exports.deleteRisk = asyncHandlerWithMapping(
  async (req, res) => {
    await riskService.deleteRisk(req.user.tenantId, req.params.id);
    success(res, null, null, "Risk deleted successfully", 200);
  },
  {
    "Risk not found": 404,
  }
);
