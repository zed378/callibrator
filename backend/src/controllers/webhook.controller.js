// src/controllers/webhook.controller.js
const webhookService = require("../services/webhook.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.create = asyncHandler(async (req, res) => {
  const data = await webhookService.createWebhook(req.user.tenantId, {
    ...req.body,
    createdBy: req.user.id,
  });
  success(res, data, null, "Webhook created", 201);
});

exports.list = asyncHandler(async (req, res) => {
  const result = await webhookService.listWebhooks(req.user.tenantId, {
    page: req.query.page,
    limit: req.query.limit,
  });
  success(res, result.rows, result.meta, "Webhooks retrieved", 200);
});

exports.getOne = asyncHandler(async (req, res) => {
  const data = await webhookService.getWebhook(req.user.tenantId, req.params.id);
  success(res, data, null, "Webhook retrieved", 200);
});

exports.update = asyncHandler(async (req, res) => {
  const data = await webhookService.updateWebhook(req.user.tenantId, req.params.id, req.body);
  success(res, data, null, "Webhook updated", 200);
});

exports.remove = asyncHandler(async (req, res) => {
  const data = await webhookService.deleteWebhook(req.user.tenantId, req.params.id);
  success(res, data, null, "Webhook deleted", 200);
});

exports.deliveries = asyncHandler(async (req, res) => {
  const result = await webhookService.listDeliveries(req.user.tenantId, req.params.id, {
    page: req.query.page,
    limit: req.query.limit,
  });
  success(res, result.rows, result.meta, "Deliveries retrieved", 200);
});

exports.test = asyncHandler(async (req, res) => {
  const data = await webhookService.testWebhook(req.user.tenantId, req.params.id);
  success(res, data, null, "Test delivery attempted", 200);
});
