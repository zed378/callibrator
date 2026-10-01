/**
 * Tests for ai controller
 */

jest.mock("../../services/ai.service", () => ({
  processCertificateOcr: jest.fn(),
  queryDocuments: jest.fn(),
  getAiConfig: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.statusCode = status;
    }
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const aiService = require("../../services/ai.service");
const aiController = require("../../controllers/ai.controller");
const { success } = require("../../utils/response.util");
const { error: sendError } = require("../../utils/response.util");

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("ai Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    // A-281: a provider is configured unless a test says otherwise.
    aiService.getAiConfig.mockResolvedValue({ apiKey: "sk-test" });
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      download: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("processOcr", () => {
    it("should process OCR and return extracted data", async () => {
      const mockBuffer = Buffer.from("test image");
      req.file = { buffer: mockBuffer, mimetype: "image/png" };

      aiService.processCertificateOcr.mockResolvedValue({
        fields: { deviceSerial: "ABC123", date: "2024-01-01" },
      });

      await aiController.processOcr(req, res, next);

      expect(aiService.processCertificateOcr).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        mockBuffer,
        "image/png",
      );
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 400 when no file is provided", async () => {
      req.file = null;

      await aiController.processOcr(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "File is required for OCR", 400);
    });

    // A-281 (ADR-094): the provider was asked and failed — an upstream failure.
    it("should return 502 when the provider returns no OCR result", async () => {
      const mockBuffer = Buffer.from("test image");
      req.file = { buffer: mockBuffer, mimetype: "image/png" };

      aiService.processCertificateOcr.mockResolvedValue(null);

      await aiController.processOcr(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "The AI provider did not return an OCR result. Try again later.", 502);
    });

    it("should return 409 explaining the configuration when no AI provider is configured", async () => {
      req.file = { buffer: Buffer.from("x"), mimetype: "image/png" };
      aiService.getAiConfig.mockResolvedValue({ apiKey: undefined });

      await aiController.processOcr(req, res, next);

      expect(aiService.processCertificateOcr).not.toHaveBeenCalled();
      expect(sendError).toHaveBeenCalledWith(res, aiController.AI_NOT_CONFIGURED, 409);
    });
  });

  describe("queryRAG", () => {
    it("should return RAG query answer", async () => {
      req.body = { question: "What is the calibration interval for ventilator X?" };

      aiService.queryDocuments.mockResolvedValue(
        "The calibration interval for ventilator X is 12 months as per manufacturer guidelines.",
      );

      await aiController.queryRAG(req, res, next);

      expect(aiService.queryDocuments).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        "What is the calibration interval for ventilator X?",
      );
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 400 when question is empty", async () => {
      req.body = { question: "" };

      await aiController.queryRAG(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Question is required", 400);
    });

    it("should return 400 when question is missing", async () => {
      req.body = {};

      await aiController.queryRAG(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Question is required", 400);
    });

    // A-281 (ADR-094)
    it("should return 502 when the provider returns no answer", async () => {
      req.body = { question: "Some question" };

      aiService.queryDocuments.mockResolvedValue(null);

      await aiController.queryRAG(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "The AI provider did not return an answer. Try again later.", 502);
    });

    it("should return 409 explaining the configuration when no AI provider is configured (was 500)", async () => {
      req.body = { question: "Some question" };
      aiService.getAiConfig.mockResolvedValue({ apiKey: "" });

      await aiController.queryRAG(req, res, next);

      expect(aiService.queryDocuments).not.toHaveBeenCalled();
      expect(sendError).toHaveBeenCalledWith(res, aiController.AI_NOT_CONFIGURED, 409);
      expect(aiController.AI_NOT_CONFIGURED).toContain("No AI provider is configured");
    });
  });
});
