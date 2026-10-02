// src/services/ai.service.ts
//
// P9-18 (ADR-087, Stage C): converted from ai.service.js with no behaviour
// change (its raw SQL moved to sql() first, as its own change). `export =`
// keeps what `require()` returned: ONE instance of the class, its methods on
// the prototype, and internal calls through `this` as before, so a test that
// replaces a method on the instance still intercepts. `AppError`, the logger,
// `TenantSettings`, the SSRF helpers and `sql` are captured at load; axios is
// read at call time; `../config` and `../models` (DocumentChunk) stay lazy.
// The OpenAI fallbacks are read at each call, through config/env.
import { AppError as LoadedAppError } from "../utils/appError.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import axios from "axios";
import models from "../models";
// A-176: `ai_base_url` is tenant-chosen; the server must not be pointed at
// its own network with it.
import {
  assertOutboundUrl as loadedAssertOutboundUrl,
  ssrfSafeAxiosOptions as loadedSsrfSafeAxiosOptions,
} from "../utils/ssrf.util";
// P9-18: the RAG store's raw SQL goes through the bind-only helper (P9-07):
// `$1…$n` bind values only, the tenant bound (D-05).
import { sql as loadedSql } from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";
import { env } from "../config/env";
import type * as ConfigModule from "../config";
import type { ModelsBarrel } from "../types/models";

const AppError = LoadedAppError;
const logger = loadedLogger;
const { TenantSettings } = models;
const assertOutboundUrl = loadedAssertOutboundUrl;
const ssrfSafeAxiosOptions = loadedSsrfSafeAxiosOptions;
const sql = loadedSql;

/** How many chunks an ingest stored. */
interface IngestResult {
  chunks: number;
}

/** A document to ingest into the RAG store. */
interface IngestInput {
  sourceType: string;
  sourceId: string;
  content: string;
}

/** The AI configuration a tenant resolves to. */
interface AiConfig {
  apiKey: string | undefined;
  baseUrl: string;
  tenantBaseUrl: boolean;
  vendor: string;
}

/** The parts of a vendor response this service reads. */
interface ChatResponse {
  data: { choices: { message: { content: string } }[] };
}
interface EmbeddingResponse {
  data: { data: { embedding: number[] }[] };
}

/** The shared Sequelize instance, loaded lazily where the `.js` required it. */
const configDb = (): SqlRunner =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  (require("../config") as typeof ConfigModule).db as unknown as SqlRunner;

/** A caught vendor error, read as the `.js` read it. */
const vendorError = (error: unknown): { message?: string; response?: { data?: unknown } } =>
  error as { message?: string; response?: { data?: unknown } };

/** A-176: timeout for one AI vendor call (a completion can be slow). */
const AI_TIMEOUT_MS = 60000;

/**
 * AZ-02 (ADR-088) — the source types `POST /ai/query` may answer from.
 *
 * The query route is gated on `sop: read` (A-94), which is only honest while
 * every chunk it can retrieve is an SOP. Retrieval filters on this list, so a
 * future ingester of another type (certificates, attachments…) indexes rows
 * that the query path cannot reach until someone adds the type HERE and
 * decides the gate that covers it — rather than silently widening what an
 * `sop: read` caller can read.
 */
const RAG_READABLE_SOURCE_TYPES = Object.freeze(["SopDocument"]);

/**
 * AI Service for OCR and RAG capabilities.
 * Fetches API keys and config from TenantSettings.
 */
class AiService {
  /**
   * Helper to retrieve AI config for a tenant
   */
  async getAiConfig(tenantId: string | null | undefined): Promise<AiConfig> {
    if (!tenantId) {
      throw new AppError(400, "tenantId is required to fetch AI config");
    }

    const settings = await TenantSettings.findAll({
      where: {
        tenantId,
        key: ["ai_api_key", "ai_base_url", "ai_vendor"],
      },
    });

    const configMap = settings.reduce<Record<string, string | undefined>>((acc, s) => {
      acc[s.key] = s.value as string | undefined;
      return acc;
    }, {});

    // Fallbacks to env vars if not set in DB (optional, but good for backward compat)
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty setting also falls back */
    return {
      apiKey: configMap["ai_api_key"] || env("OPENAI_API_KEY"),
      baseUrl: configMap["ai_base_url"] || env("OPENAI_BASE_URL") || "https://api.openai.com/v1",
      // A-176: only the operator's own URL (env / default) skips the SSRF guard.
      tenantBaseUrl: Boolean(configMap["ai_base_url"]),
      vendor: configMap["ai_vendor"] || "openai",
    };
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  }

  /**
   * A-176 — axios options for a call to the AI vendor. A tenant-chosen base
   * URL is validated and called through the SSRF-safe agents (pinned DNS, no
   * redirects, capped body); the operator's own URL keeps a plain timeout.
   * Throws AppError(400) for a disallowed tenant URL — every caller catches it
   * and degrades exactly as for any other vendor failure.
   */
  vendorRequestOptions(config: AiConfig, url: string): Record<string, unknown> {
    if (config.tenantBaseUrl) {
      assertOutboundUrl(url, "ai_base_url");
      return ssrfSafeAxiosOptions({ timeoutMs: AI_TIMEOUT_MS });
    }
    return { timeout: AI_TIMEOUT_MS };
  }

  /**
   * Process an uploaded certificate PDF/Image using Vision AI (OCR).
   * Extracts key-value pairs like Certificate Number, Calibration Date, etc.
   *
   * @param tenantId
   * @param fileBuffer - The file data
   * @param mimeType - The MIME type (e.g., application/pdf, image/jpeg)
   * @returns Extracted metadata or null if AI is disabled/fails
   */
  async processCertificateOcr(tenantId: string, fileBuffer: Buffer, mimeType: string): Promise<unknown> {
    const config = await this.getAiConfig(tenantId);

    if (!config.apiKey) {
      logger.warn("OCR requested but AI API Key is not configured for tenant. Skipping OCR.");
      return null;
    }

    try {
      const base64Data = fileBuffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      const url = `${config.baseUrl}/chat/completions`;
      const response: ChatResponse = await axios.post(
        url,
        {
          model: "gpt-4o", // Vision capable model
          messages: [
            {
              role: "system",
              content: "You are an expert at extracting data from calibration certificates. Return ONLY a JSON object with keys: certificateNumber, calibrationDate, dueDate, vendorName, deviceSerialNumber, status(PASS/FAIL).",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the data from this calibration certificate." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        },
        {
          ...this.vendorRequestOptions(config, url),
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      // As built: a response without a first choice throws, and is caught below.
      const content = (response.data.choices[0] as { message: { content: string } }).message.content;
      return JSON.parse(content) as unknown;
    } catch (error) {
      logger.error("OCR extraction failed", { error: vendorError(error).message, details: vendorError(error).response?.data });
      // Return null instead of throwing to prevent backend interruption
      return null;
    }
  }

  /**
   * Generate vector embeddings for a document chunk.
   *
   * @param tenantId
   * @param text - The text to embed
   * @returns The vector embedding or null if AI is disabled/fails
   */
  async generateEmbedding(tenantId: string, text: string): Promise<number[] | null> {
    const config = await this.getAiConfig(tenantId);

    if (!config.apiKey) {
      logger.warn("Embedding requested but AI API Key is not configured for tenant.");
      return null;
    }

    try {
      const url = `${config.baseUrl}/embeddings`;
      const response: EmbeddingResponse = await axios.post(
        url,
        {
          model: "text-embedding-3-small",
          input: text,
        },
        {
          ...this.vendorRequestOptions(config, url),
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      // As built: a response without a first item throws, and is caught below.
      return (response.data.data[0] as { embedding: number[] }).embedding;
    } catch (error) {
      logger.error("Embedding generation failed", { error: vendorError(error).message });
      return null;
    }
  }

  /**
   * Split a document into chunks for embedding. Splits on paragraph
   * boundaries first, then packs paragraphs up to ~maxChars per chunk so chunks
   * stay semantically coherent and within the embedding model's context.
   *
   * The chunks do NOT overlap (A-18: this said "overlapping", and nothing here
   * ever overlapped). A sentence split across two chunks is retrievable only
   * from each half. Adding overlap changes every stored embedding and is a
   * retrieval-quality decision, not a comment fix.
   *
   * @param text
   * @param maxChars
   */
  chunkText(text: unknown, maxChars = 1000): string[] {
    const paragraphs = String(text)
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const chunks: string[] = [];
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
   * @param tenantId
   * @param doc
   */
  async ingestDocument(tenantId: string, { sourceType, sourceId, content }: IngestInput): Promise<IngestResult> {
    if (!tenantId || !sourceType || !sourceId) {
      throw new AppError(400, "tenantId, sourceType and sourceId are required");
    }
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
    if (!content || !content.trim()) {
      return { chunks: 0 };
    }

    const db = configDb();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
    const { DocumentChunk } = require("../models") as ModelsBarrel;

    // Replace any prior chunks for this source (idempotent re-ingest).
    await DocumentChunk.destroy({ where: { tenantId, sourceType, sourceId } });

    const chunks = this.chunkText(content);
    let stored = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as string;
      const embedding = await this.generateEmbedding(tenantId, chunk);
      if (!embedding) {
        // No embedding (AI unconfigured/failed) — skip; nothing to search on.
        continue;
      }

      // pgvector column is not an ORM attribute; insert via raw SQL. The
      // tenant predicate is explicit because raw SQL bypasses the scoping hooks.
      await sql(
        db,
        `INSERT INTO document_chunks
           (id, tenant_id, source_type, source_id, chunk_index, content, embedding, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector, now(), now())`,
        [tenantId, sourceType, sourceId, i, chunk, JSON.stringify(embedding)],
      );
      stored += 1;
    }

    logger.info("Document ingested for RAG", { tenantId, sourceType, sourceId, chunks: stored });
    return { chunks: stored };
  }

  /**
   * Retrieve the most relevant chunks for a query embedding: a pgvector
   * cosine-distance search, scoped to the tenant explicitly (raw SQL bypasses
   * the tenant hooks). PostgreSQL only (ADR-039) — the former non-pgvector
   * branch returned the five most RECENT chunks as "context" regardless of
   * relevance, which produced confident answers from the wrong documents.
   *
   * @param tenantId
   * @param queryVector
   * @param limit
   */
  async retrieveContext(
    tenantId: string,
    queryVector: number[],
    limit = 5,
  ): Promise<{ content: string; similarity: number }[]> {
    const db = configDb();
    // AZ-02 (ADR-088): only the source types the query route's gate covers.
    const rows = await sql<{ content: string; similarity: unknown }>(
      db,
      `SELECT content, 1 - (embedding <=> $1::vector) AS similarity
         FROM document_chunks
        WHERE tenant_id = $2 AND embedding IS NOT NULL
          AND source_type = ANY($4::text[])
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [JSON.stringify(queryVector), tenantId, limit, RAG_READABLE_SOURCE_TYPES],
    );
    return rows.map((r) => ({ content: r.content, similarity: Number(r.similarity) }));
  }

  /**
   * RAG Query: Ask a question over a specific tenant's knowledge base. Answers
   * are grounded in the tenant's own ingested documents (no longer a simulated
   * context string).
   *
   * @param tenantId
   * @param question
   * @returns The answer or null if AI is disabled/fails
   */
  async queryDocuments(tenantId: string, question: string): Promise<string | null> {
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
      const url = `${config.baseUrl}/chat/completions`;
      const response: ChatResponse = await axios.post(
        url,
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
          ...this.vendorRequestOptions(config, url),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      // As built: a response without a first choice throws, and is caught below.
      return (response.data.choices[0] as { message: { content: string } }).message.content;
    } catch (error) {
      logger.error("RAG completion failed", { error: vendorError(error).message });
      return null;
    }
  }
}

export = new AiService();
