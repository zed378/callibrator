const aiService = require("../services/ai.service");
const { success } = require("../utils/response.util");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");
const { AppError } = require("../utils/appError.util");

exports.processOcr = asyncHandlerWithMapping(
  async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "File is required for OCR");
    }

    const { buffer, mimetype } = req.file;
    const result = await aiService.processCertificateOcr(req.user.tenantId, buffer, mimetype);

    if (!result) {
      throw new AppError(500, "OCR extraction failed or AI not configured");
    }

    success(res, result, null, "OCR extraction successful", 200);
  },
  {}
);

exports.queryRAG = asyncHandlerWithMapping(
  async (req, res) => {
    const { question } = req.body;
    if (!question) {
      throw new AppError(400, "Question is required");
    }

    const result = await aiService.queryDocuments(req.user.tenantId, question);

    if (!result) {
      throw new AppError(500, "RAG query failed or AI not configured");
    }

    success(res, { answer: result }, null, "RAG query successful", 200);
  },
  {}
);
