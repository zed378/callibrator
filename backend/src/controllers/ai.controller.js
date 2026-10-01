const aiService = require("../services/ai.service");
const { success } = require("../utils/response.util");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");
const { AppError } = require("../utils/appError.util");

// ---------------------------------------------------------------------------
// A-281 (ADR-094) — a missing AI provider is a state of the tenant, not a
// server fault. Both endpoints used to answer 500 "failed or AI not
// configured" for it, which pages whoever watches 5xx and tells the caller
// nothing. Now:
//  - no provider configured  -> 409, naming what to configure (the caller's
//    administrator can change it; retrying cannot);
//  - the provider was asked and failed -> 502 (an upstream failure: the
//    request was well formed and the configuration present).
// ---------------------------------------------------------------------------
const AI_NOT_CONFIGURED =
  "No AI provider is configured for this organisation, so AI features are off. " +
  "An administrator can enable them by setting the AI API key (ai_api_key, with " +
  "ai_base_url and ai_vendor if not OpenAI) in the organisation's settings.";
exports.AI_NOT_CONFIGURED = AI_NOT_CONFIGURED;

const assertAiConfigured = async (tenantId) => {
  const config = await aiService.getAiConfig(tenantId);
  if (!config.apiKey) {
    throw new AppError(409, AI_NOT_CONFIGURED);
  }
};

exports.processOcr = asyncHandlerWithMapping(
  async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "File is required for OCR");
    }

    await assertAiConfigured(req.user.tenantId);
    const { buffer, mimetype } = req.file;
    const result = await aiService.processCertificateOcr(req.user.tenantId, buffer, mimetype);

    if (!result) {
      throw new AppError(502, "The AI provider did not return an OCR result. Try again later.");
    }

    success(res, result, null, "OCR extraction successful", 200);
  },
  {},
);

exports.queryRAG = asyncHandlerWithMapping(
  async (req, res) => {
    const { question } = req.body || {};
    if (!question) {
      throw new AppError(400, "Question is required");
    }

    await assertAiConfigured(req.user.tenantId);
    const result = await aiService.queryDocuments(req.user.tenantId, question);

    if (!result) {
      throw new AppError(502, "The AI provider did not return an answer. Try again later.");
    }

    success(res, { answer: result }, null, "RAG query successful", 200);
  },
  {},
);
