const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");
const axios = require("axios");
const { TenantSettings } = require("../models");

/**
 * AI Service for OCR and RAG capabilities.
 * Fetches API keys and config from TenantSettings.
 */
class AiService {
  /**
   * Helper to retrieve AI config for a tenant
   */
  async getAiConfig(tenantId) {
    if (!tenantId) {
      throw new AppError(400, "tenantId is required to fetch AI config");
    }

    const settings = await TenantSettings.findAll({
      where: {
        tenantId,
        key: ['ai_api_key', 'ai_base_url', 'ai_vendor']
      }
    });

    const configMap = settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {});

    // Fallbacks to env vars if not set in DB (optional, but good for backward compat)
    return {
      apiKey: configMap.ai_api_key || process.env.OPENAI_API_KEY,
      baseUrl: configMap.ai_base_url || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      vendor: configMap.ai_vendor || "openai"
    };
  }

  /**
   * Process an uploaded certificate PDF/Image using Vision AI (OCR).
   * Extracts key-value pairs like Certificate Number, Calibration Date, etc.
   * 
   * @param {string} tenantId 
   * @param {Buffer} fileBuffer - The file data
   * @param {string} mimeType - The MIME type (e.g., application/pdf, image/jpeg)
   * @returns {Promise<Object|null>} Extracted metadata or null if AI is disabled/fails
   */
  async processCertificateOcr(tenantId, fileBuffer, mimeType) {
    const config = await this.getAiConfig(tenantId);

    if (!config.apiKey) {
      logger.warn("OCR requested but AI API Key is not configured for tenant. Skipping OCR.");
      return null;
    }

    try {
      const base64Data = fileBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      const response = await axios.post(
        `${config.baseUrl}/chat/completions`,
        {
          model: "gpt-4o", // Vision capable model
          messages: [
            {
              role: "system",
              content: "You are an expert at extracting data from calibration certificates. Return ONLY a JSON object with keys: certificateNumber, calibrationDate, dueDate, vendorName, deviceSerialNumber, status(PASS/FAIL)."
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the data from this calibration certificate." },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        },
        {
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      const content = response.data.choices[0].message.content;
      return JSON.parse(content);
    } catch (error) {
      logger.error("OCR extraction failed", { error: error.message, details: error.response?.data });
      // Return null instead of throwing to prevent backend interruption
      return null;
    }
  }

  /**
   * Generate vector embeddings for a document chunk.
   * 
   * @param {string} tenantId
   * @param {string} text - The text to embed
   * @returns {Promise<number[]|null>} The vector embedding or null if AI is disabled/fails
   */
  async generateEmbedding(tenantId, text) {
    const config = await this.getAiConfig(tenantId);

    if (!config.apiKey) {
      logger.warn("Embedding requested but AI API Key is not configured for tenant.");
      return null;
    }

    try {
      const response = await axios.post(
        `${config.baseUrl}/embeddings`,
        {
          model: "text-embedding-3-small",
          input: text
        },
        {
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      return response.data.data[0].embedding;
    } catch (error) {
      logger.error("Embedding generation failed", { error: error.message });
      return null;
    }
  }

  /**
   * Split a document into overlapping chunks for embedding. Splits on paragraph
   * boundaries first, then packs paragraphs up to ~maxChars per chunk so chunks
   * stay semantically coherent and within the embedding model's context.
   *
   * @param {string} text
   * @param {number} maxChars
   * @returns {string[]}
   */
  chunkText(text, maxChars = 1000) {
    const paragraphs = String(text)
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const chunks = [];
    let current = "";

    for (const para of paragraphs) {
      if (current && current.length + para.length + 2 > maxChars) {
        chunks.push(current);
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
      // A single oversized paragraph is hard-split so no chunk exceeds the cap.
      while (current.length > maxChars) {
        chunks.push(current.slice(0, maxChars));
        current = current.slice(maxChars);
      }
    }

    if (current) {
      chunks.push(current);
    }
    return chunks;
  }

  /**
   * Ingest a document into the RAG store: chunk it, embed each chunk, and
   * persist. Existing chunks for the same source are replaced so re-ingesting an
   * updated document does not leave stale content.
   *
   * @param {string} tenantId
   * @param {{sourceType: string, sourceId: string, content: string}} doc
   * @returns {Promise<{chunks: number}>}
   */
  async ingestDocument(tenantId, { sourceType, sourceId, content }) {
    if (!tenantId || !sourceType || !sourceId) {
      throw new AppError(400, "tenantId, sourceType and sourceId are required");
    }
    if (!content || !content.trim()) {
      return { chunks: 0 };
    }

    const { db } = require("../config");
    const { DocumentChunk } = require("../models");
    const dialect = db.getDialect();

    // Replace any prior chunks for this source (idempotent re-ingest).
    await DocumentChunk.destroy({ where: { tenantId, sourceType, sourceId } });

    const chunks = this.chunkText(content);
    let stored = 0;

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.generateEmbedding(tenantId, chunks[i]);
      if (!embedding) {
        // No embedding (AI unconfigured/failed) — skip; nothing to search on.
        continue;
      }

      if (dialect === "postgres") {
        // pgvector column is not an ORM attribute; insert via raw SQL.
        await db.query(
          `INSERT INTO document_chunks
             (id, tenant_id, source_type, source_id, chunk_index, content, embedding, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector, now(), now())`,
          { bind: [tenantId, sourceType, sourceId, i, chunks[i], JSON.stringify(embedding)] },
        );
      } else {
        await DocumentChunk.create({
          tenantId,
          sourceType,
          sourceId,
          chunkIndex: i,
          content: chunks[i],
        });
      }
      stored += 1;
    }

    logger.info("Document ingested for RAG", { tenantId, sourceType, sourceId, chunks: stored });
    return { chunks: stored };
  }

  /**
   * Retrieve the most relevant chunks for a query embedding. On Postgres this is
   * a real pgvector cosine-distance search; on other engines it degrades to a
   * recency fallback (no semantic ranking) so the feature still functions.
   *
   * @param {string} tenantId
   * @param {number[]} queryVector
   * @param {number} limit
   * @returns {Promise<Array<{content: string, similarity: number|null}>>}
   */
  async retrieveContext(tenantId, queryVector, limit = 5) {
    const { db } = require("../config");
    const dialect = db.getDialect();

    if (dialect === "postgres") {
      const rows = await db.query(
        `SELECT content, 1 - (embedding <=> $1::vector) AS similarity
           FROM document_chunks
          WHERE tenant_id = $2 AND embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT $3`,
        {
          bind: [JSON.stringify(queryVector), tenantId, limit],
          type: db.QueryTypes.SELECT,
        },
      );
      return rows.map((r) => ({ content: r.content, similarity: Number(r.similarity) }));
    }

    // Non-pgvector engines: return the most recent chunks (best-effort).
    const { DocumentChunk } = require("../models");
    const rows = await DocumentChunk.findAll({
      where: { tenantId },
      order: [["createdAt", "DESC"]],
      limit,
    });
    return rows.map((r) => ({ content: r.content, similarity: null }));
  }

  /**
   * RAG Query: Ask a question over a specific tenant's knowledge base. Answers
   * are grounded in the tenant's own ingested documents (no longer a simulated
   * context string).
   *
   * @param {string} tenantId
   * @param {string} question
   * @returns {Promise<string|null>} The answer or null if AI is disabled/fails
   */
  async queryDocuments(tenantId, question) {
    const config = await this.getAiConfig(tenantId);

    if (!config.apiKey) {
      logger.warn("RAG query requested but AI API Key is not configured for tenant.");
      return null;
    }

    // 1. Embed the question.
    const queryVector = await this.generateEmbedding(tenantId, question);
    if (!queryVector) {
      return null;
    }

    // 2. Retrieve the most relevant chunks from the tenant's knowledge base.
    const contexts = await this.retrieveContext(tenantId, queryVector);
    const contextStr = contexts.length
      ? contexts.map((c) => c.content).join("\n---\n")
      : "No relevant documents were found in the knowledge base.";

    // 3. Answer strictly from the retrieved context.
    try {
      const response = await axios.post(
        `${config.baseUrl}/chat/completions`,
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant. Answer using ONLY the provided document context. If the context does not contain the answer, say you don't have that information.",
            },
            {
              role: "user",
              content: `Context:\n${contextStr}\n\nQuestion: ${question}`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      logger.error("RAG completion failed", { error: error.message });
      return null;
    }
  }
}

module.exports = new AiService();
