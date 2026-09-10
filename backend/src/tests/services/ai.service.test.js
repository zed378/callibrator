/**
 * Tests for ai.service.js
 *
 * Covers: getAiConfig, processCertificateOcr, generateEmbedding, queryDocuments
 */

jest.mock("../../config", () => ({
  Sequelize: { useCLS: jest.fn() },
  db: {
    getDialect: jest.fn(() => "sqlite"),
    query: jest.fn(),
    QueryTypes: { SELECT: "SELECT" },
  },
}));

jest.mock("../../models", () => ({
  TenantSettings: {
    findAll: jest.fn(),
  },
  DocumentChunk: {
    destroy: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
  },
}));

/**
 * Mock AppError to ensure constructor is available
 */
jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("axios", () => ({
  post: jest.fn(),
}));

const axios = require("axios");
const { TenantSettings, DocumentChunk } = require("../../models");
const { db } = require("../../config");
const aiService = require("../../services/ai.service");

describe("ai.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    // Sensible defaults for the RAG store so retrieval doesn't blow up.
    db.getDialect.mockReturnValue("sqlite");
    db.query.mockResolvedValue([]);
    DocumentChunk.destroy.mockResolvedValue(0);
    DocumentChunk.create.mockResolvedValue({});
    DocumentChunk.findAll.mockResolvedValue([]);
  });

  // ================================================================
  describe("getAiConfig", () => {
    it("should throw when tenantId is missing", async () => {
      await expect(aiService.getAiConfig(null)).rejects.toThrow(
        "tenantId is required to fetch AI config",
      );
    });

    it("should fetch tenant AI settings and build config", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([
        { key: "ai_api_key", value: "sk-test-key" },
        { key: "ai_base_url", value: "https://custom.ai.com" },
        { key: "ai_vendor", value: "anthropic" },
      ]);

      const result = await aiService.getAiConfig("tenant-1");

      expect(result.apiKey).toBe("sk-test-key");
      expect(result.baseUrl).toBe("https://custom.ai.com");
      expect(result.vendor).toBe("anthropic");
      expect(TenantSettings.findAll).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant-1",
          key: ["ai_api_key", "ai_base_url", "ai_vendor"],
        },
      });
    });

    it("should fallback to env vars when no tenant settings", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([]);
      process.env.OPENAI_API_KEY = "env-key";
      process.env.OPENAI_BASE_URL = "https://env-url.com";

      const result = await aiService.getAiConfig("tenant-1");

      expect(result.apiKey).toBe("env-key");
      expect(result.baseUrl).toBe("https://env-url.com");
      expect(result.vendor).toBe("openai");
    });
  });

  // ================================================================
  describe("processCertificateOcr", () => {
    it("should return null when API key is not configured", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([]);

      const result = await aiService.processCertificateOcr(
        "tenant-1",
        Buffer.from("file"),
        "image/png",
      );

      expect(result).toBeNull();
    });

    it("should call the vision API and return parsed JSON", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([
        { key: "ai_api_key", value: "sk-key" },
        { key: "ai_base_url", value: "https://api.openai.com/v1" },
        { key: "ai_vendor", value: "openai" },
      ]);
      axios.post.mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: '{"certificateNumber":"C-001","status":"PASS"}',
              },
            },
          ],
        },
      });

      const result = await aiService.processCertificateOcr(
        "tenant-1",
        Buffer.from("test-image"),
        "image/png",
      );

      expect(result).toEqual({ certificateNumber: "C-001", status: "PASS" });
      expect(axios.post).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          model: "gpt-4o",
          response_format: { type: "json_object" },
        }),
        expect.any(Object),
      );
    });

    it("should return null on API failure without throwing", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([
        { key: "ai_api_key", value: "sk-key" },
        { key: "ai_base_url", value: "https://api.openai.com/v1" },
        { key: "ai_vendor", value: "openai" },
      ]);
      axios.post.mockRejectedValueOnce(new Error("API timeout"));

      const result = await aiService.processCertificateOcr(
        "tenant-1",
        Buffer.from("test"),
        "image/jpeg",
      );

      expect(result).toBeNull();
    });
  });

  // ================================================================
  describe("generateEmbedding", () => {
    it("should return null when API key is missing", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([]);

      const result = await aiService.generateEmbedding("tenant-1", "some text");

      expect(result).toBeNull();
    });

    it("should call the embeddings API and return vector", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([
        { key: "ai_api_key", value: "sk-key" },
        { key: "ai_base_url", value: "https://api.openai.com/v1" },
        { key: "ai_vendor", value: "openai" },
      ]);
      axios.post.mockResolvedValueOnce({
        data: { data: [{ embedding: [0.1, 0.2, 0.3] }] },
      });

      const result = await aiService.generateEmbedding(
        "tenant-1",
        "hello world",
      );

      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("should return null on error", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([
        { key: "ai_api_key", value: "sk-key" },
        { key: "ai_base_url", value: "https://api.openai.com/v1" },
        { key: "ai_vendor", value: "openai" },
      ]);
      axios.post.mockRejectedValueOnce(new Error("rate limited"));

      const result = await aiService.generateEmbedding("tenant-1", "text");

      expect(result).toBeNull();
    });
  });

  // ================================================================
  describe("queryDocuments", () => {
    it("should return null when API key is missing", async () => {
      TenantSettings.findAll.mockResolvedValueOnce([]);

      const result = await aiService.queryDocuments(
        "tenant-1",
        "what is calibration?",
      );

      expect(result).toBeNull();
    });

    it("should embed the question and call LLM with context", async () => {
      TenantSettings.findAll
        .mockResolvedValueOnce([
          { key: "ai_api_key", value: "sk-key" },
          { key: "ai_base_url", value: "https://api.openai.com/v1" },
          { key: "ai_vendor", value: "openai" },
        ])
        .mockResolvedValueOnce([
          { key: "ai_api_key", value: "sk-key" },
          { key: "ai_base_url", value: "https://api.openai.com/v1" },
          { key: "ai_vendor", value: "openai" },
        ]);
      // generateEmbedding calls axios.post first, then queryDocuments calls it again
      axios.post
        .mockResolvedValueOnce({
          data: { data: [{ embedding: [0.1, 0.2] }] },
        })
        .mockResolvedValueOnce({
          data: {
            choices: [
              { message: { content: "Calibration is the process..." } },
            ],
          },
        });

      const result = await aiService.queryDocuments(
        "tenant-1",
        "what is calibration?",
      );

      expect(result).toBe("Calibration is the process...");
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it("should return null when embedding fails", async () => {
      TenantSettings.findAll
        .mockResolvedValueOnce([
          { key: "ai_api_key", value: "sk-key" },
          { key: "ai_base_url", value: "https://api.openai.com/v1" },
          { key: "ai_vendor", value: "openai" },
        ])
        .mockResolvedValueOnce([
          { key: "ai_api_key", value: "sk-key" },
          { key: "ai_base_url", value: "https://api.openai.com/v1" },
          { key: "ai_vendor", value: "openai" },
        ]);
      axios.post.mockRejectedValueOnce(new Error("embedding failed"));

      const result = await aiService.queryDocuments("tenant-1", "question");

      expect(result).toBeNull();
    });

    it("should return null when the RAG completion call fails", async () => {
      const settings = [
        { key: "ai_api_key", value: "sk-key" },
        { key: "ai_base_url", value: "https://api.openai.com/v1" },
        { key: "ai_vendor", value: "openai" },
      ];
      TenantSettings.findAll
        .mockResolvedValueOnce(settings)
        .mockResolvedValueOnce(settings);
      // embedding succeeds, the chat completion then fails
      axios.post
        .mockResolvedValueOnce({ data: { data: [{ embedding: [0.1, 0.2] }] } })
        .mockRejectedValueOnce(new Error("llm exploded"));

      const { logger } = require("../../middlewares/activityLog.middleware");
      const result = await aiService.queryDocuments("tenant-1", "question");

      expect(result).toBeNull();
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith("RAG completion failed", {
        error: "llm exploded",
      });
    });

    it("joins retrieved chunks into the context", async () => {
      const settings = [{ key: "ai_api_key", value: "sk-key" }];
      TenantSettings.findAll.mockResolvedValue(settings);
      db.getDialect.mockReturnValue("sqlite");
      DocumentChunk.findAll.mockResolvedValue([
        { content: "chunk A" },
        { content: "chunk B" },
      ]);
      axios.post
        .mockResolvedValueOnce({ data: { data: [{ embedding: [0.1] }] } })
        .mockResolvedValueOnce({ data: { choices: [{ message: { content: "answer" } }] } });

      const result = await aiService.queryDocuments("tenant-1", "q");

      expect(result).toBe("answer");
      const chatBody = axios.post.mock.calls[1][1];
      expect(chatBody.messages[1].content).toContain("chunk A");
      expect(chatBody.messages[1].content).toContain("chunk B");
    });
  });

  // ================================================================
  describe("chunkText", () => {
    it("packs paragraphs up to the size cap", () => {
      const text = "para one\n\npara two\n\npara three";
      const chunks = aiService.chunkText(text, 20);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(20));
    });

    it("hard-splits a single oversized paragraph", () => {
      const chunks = aiService.chunkText("x".repeat(2500), 1000);
      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(1000);
    });

    it("returns an empty array for blank input", () => {
      expect(aiService.chunkText("   \n\n  ")).toEqual([]);
    });
  });

  // ================================================================
  describe("ingestDocument", () => {
    it("throws when required identifiers are missing", async () => {
      await expect(
        aiService.ingestDocument("", { sourceType: "Sop", sourceId: "1", content: "x" }),
      ).rejects.toThrow("tenantId, sourceType and sourceId are required");
    });

    it("returns zero chunks for empty content", async () => {
      const result = await aiService.ingestDocument("t1", {
        sourceType: "Sop",
        sourceId: "1",
        content: "   ",
      });
      expect(result).toEqual({ chunks: 0 });
      expect(DocumentChunk.destroy).not.toHaveBeenCalled();
    });

    it("replaces prior chunks and stores embeddings on postgres via raw SQL", async () => {
      db.getDialect.mockReturnValue("postgres");
      TenantSettings.findAll.mockResolvedValue([{ key: "ai_api_key", value: "sk-key" }]);
      axios.post.mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2] }] } });

      const result = await aiService.ingestDocument("t1", {
        sourceType: "Sop",
        sourceId: "s1",
        content: "hello world",
      });

      expect(DocumentChunk.destroy).toHaveBeenCalledWith({
        where: { tenantId: "t1", sourceType: "Sop", sourceId: "s1" },
      });
      expect(db.query).toHaveBeenCalled();
      expect(db.query.mock.calls[0][0]).toContain("INSERT INTO document_chunks");
      expect(result.chunks).toBe(1);
    });

    it("uses the ORM on non-postgres engines", async () => {
      db.getDialect.mockReturnValue("sqlite");
      TenantSettings.findAll.mockResolvedValue([{ key: "ai_api_key", value: "sk-key" }]);
      axios.post.mockResolvedValue({ data: { data: [{ embedding: [0.1] }] } });

      const result = await aiService.ingestDocument("t1", {
        sourceType: "Sop",
        sourceId: "s1",
        content: "hello world",
      });

      expect(DocumentChunk.create).toHaveBeenCalled();
      expect(result.chunks).toBe(1);
    });

    it("skips chunks whose embedding cannot be generated", async () => {
      TenantSettings.findAll.mockResolvedValue([]); // no API key => embedding null
      const result = await aiService.ingestDocument("t1", {
        sourceType: "Sop",
        sourceId: "s1",
        content: "hello world",
      });
      expect(result.chunks).toBe(0);
      expect(DocumentChunk.create).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("retrieveContext", () => {
    it("runs a pgvector similarity search on postgres", async () => {
      db.getDialect.mockReturnValue("postgres");
      db.query.mockResolvedValue([
        { content: "a", similarity: "0.9" },
        { content: "b", similarity: "0.5" },
      ]);

      const rows = await aiService.retrieveContext("t1", [0.1, 0.2], 3);

      expect(db.query.mock.calls[0][0]).toContain("embedding <=> $1::vector");
      expect(rows).toEqual([
        { content: "a", similarity: 0.9 },
        { content: "b", similarity: 0.5 },
      ]);
    });

    it("falls back to recent chunks on non-postgres engines", async () => {
      db.getDialect.mockReturnValue("sqlite");
      DocumentChunk.findAll.mockResolvedValue([{ content: "x" }]);

      const rows = await aiService.retrieveContext("t1", [0.1]);

      expect(rows).toEqual([{ content: "x", similarity: null }]);
    });
  });
});
