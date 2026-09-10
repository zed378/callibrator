const scorecardService = require("../services/supplierScorecard.service");
const { success } = require("../utils/response.util");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");

exports.createScorecard = asyncHandlerWithMapping(
  async (req, res) => {
    const data = await scorecardService.createScorecard(req.user.tenantId, req.body, req.user.id);
    success(res, data, null, "Scorecard created successfully", 201);
  },
  {
    "Vendor not found": 404,
  }
);

exports.getScorecards = asyncHandlerWithMapping(
  async (req, res) => {
    // House style: rows in `data` (top-level array), pagination in `meta`.
    // The whole { rows, total, ... } object used to sit in `data`, so the
    // frontend list (reads `data` as an array) always rendered empty.
    const { rows, total, page, totalPages } = await scorecardService.getScorecards(
      req.user.tenantId,
      req.query,
    );
    const limit = parseInt(req.query.limit, 10) || 10;
    success(res, rows, { total, page, limit, totalPages }, "Scorecards retrieved successfully", 200);
  },
  {}
);

exports.getScorecardById = asyncHandlerWithMapping(
  async (req, res) => {
    const data = await scorecardService.getScorecardById(req.user.tenantId, req.params.id);
    success(res, data, null, "Scorecard retrieved successfully", 200);
  },
  {
    "Scorecard not found": 404,
  }
);

exports.updateScorecard = asyncHandlerWithMapping(
  async (req, res) => {
    const data = await scorecardService.updateScorecard(req.user.tenantId, req.params.id, req.body);
    success(res, data, null, "Scorecard updated successfully", 200);
  },
  {
    "Scorecard not found": 404,
  }
);

exports.deleteScorecard = asyncHandlerWithMapping(
  async (req, res) => {
    await scorecardService.deleteScorecard(req.user.tenantId, req.params.id);
    success(res, null, null, "Scorecard deleted successfully", 200);
  },
  {
    "Scorecard not found": 404,
  }
);
