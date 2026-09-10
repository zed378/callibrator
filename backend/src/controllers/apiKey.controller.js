// src/controllers/apiKey.controller.js
const apiKeyService = require("../services/apiKey.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.create = asyncHandler(async (req, res) => {
  const data = await apiKeyService.createApiKey(req.user.tenantId, {
    name: req.body.name,
    scopes: req.body.scopes,
    expiresAt: req.body.expiresAt,
    createdBy: req.user.id,
  });
  success(
    res,
    data,
    null,
    "API key created — copy the key now, it will not be shown again",
    201,
  );
});

exports.list = asyncHandler(async (req, res) => {
  const result = await apiKeyService.listApiKeys(req.user.tenantId, {
    page: req.query.page,
    limit: req.query.limit,
  });
  success(res, result.rows, result.meta, "API keys retrieved", 200);
});

exports.getOne = asyncHandler(async (req, res) => {
  const data = await apiKeyService.getApiKey(req.user.tenantId, req.params.id);
  success(res, data, null, "API key retrieved", 200);
});

exports.revoke = asyncHandler(async (req, res) => {
  const data = await apiKeyService.revokeApiKey(req.user.tenantId, req.params.id);
  success(res, data, null, "API key revoked", 200);
});
