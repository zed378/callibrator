/**
 * AZ-02 (ADR-088) — the RAG query path answers only from what its gate covers.
 *
 * `POST /ai/query` is gated on `sop: read` (A-94, proven role by role in
 * routes/ai.gate.a94.test.js). That gate is only honest while every chunk the
 * query can retrieve is an SOP. Before AZ-02 retrieval filtered on the tenant
 * alone, so the day anyone ingested a second source type (the model's own
 * comment names "Post"), an `sop: read` caller could read it through a
 * question — the AZ-02 finding: "retrieval-augmented answers inherit the
 * permissions of the index, not of the asker".
 *
 * Retrieval now also filters on `source_type = ANY($4)` over
 * RAG_READABLE_SOURCE_TYPES. The SQL was also run once against pgvector on
 * PostgreSQL 18 (see MEMORY/records/2026-09-27-az-authz-matrix-and-records.md);
 * this file pins the query's shape and the ingester/allow-list agreement.
 */

jest.mock("../../config", () => ({
  db: { query: jest.fn(), QueryTypes: { SELECT: "SELECT" } },
}));
jest.mock("../../models", () => ({
  TenantSettings: { findAll: jest.fn() },
  DocumentChunk: { destroy: jest.fn() },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("axios", () => ({ post: jest.fn() }));

const fs = require("fs");
const path = require("path");
const { db } = require("../../config");
const aiService = require("../../services/ai.service");

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([]);
});

describe("AZ-02 — retrieval is filtered to the gate's source types", () => {
  it("the query filters source_type against a bound list, next to the tenant predicate", async () => {
    await aiService.retrieveContext("tenant-a", [0.1, 0.2]);

    const [sql, options] = db.query.mock.calls[0];
    expect(sql).toContain("tenant_id = $2");
    expect(sql).toContain("source_type = ANY($4::text[])");
    // Bound, not interpolated: the list never reaches the SQL text.
    expect(sql).not.toContain("SopDocument");
    expect(options.bind[3]).toEqual(["SopDocument"]);
  });

  it("the list is exactly what `sop: read` covers — widening it is a gate decision, not a code change", async () => {
    await aiService.retrieveContext("tenant-a", [0.1]);

    expect(db.query.mock.calls[0][1].bind[3]).toEqual(["SopDocument"]);
    expect(Object.isFrozen(db.query.mock.calls[0][1].bind[3])).toBe(true);
  });

  it("the only ingester in the tree writes a type the query may read", () => {
    // If a second ingester appears, this still passes — the filter keeps its
    // rows out of answers — but a new type written by THIS script without the
    // list changing would index SOPs the query can no longer see.
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "scripts", "backfillEmbeddings.ts"),
      "utf8",
    );
    const types = [...src.matchAll(/sourceType:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(types).toEqual(["SopDocument"]);
  });

  it("queryDocuments answers from the filtered retrieval only", async () => {
    const axios = require("axios");
    const { TenantSettings } = require("../../models");
    TenantSettings.findAll.mockResolvedValue([{ key: "ai_api_key", value: "k" }]);
    axios.post
      .mockResolvedValueOnce({ data: { data: [{ embedding: [0.3, 0.4] }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: "ans" } }] } });
    db.query.mockResolvedValue([{ content: "SOP text", similarity: "0.8" }]);

    const answer = await aiService.queryDocuments("tenant-a", "q?");

    expect(answer).toBe("ans");
    const retrieval = db.query.mock.calls.find(([sql]) => sql.includes("FROM document_chunks"));
    expect(retrieval[0]).toContain("source_type = ANY($4::text[])");
    expect(retrieval[1].bind[1]).toBe("tenant-a");
  });
});
