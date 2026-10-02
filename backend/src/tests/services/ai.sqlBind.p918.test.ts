/**
 * P9-18 (ai, its own change before the conversion): the RAG store's raw SQL
 * goes through the bind-only helper `sql()` (utils/sql.util, P9-07).
 *
 * The chunk INSERT and the similarity SELECT called `db.query` directly,
 * which a TypeScript module may not do (P9-07's lint rule). Through `sql()`
 * each statement is sent with exactly `{ type: "SELECT", bind }`: `$1…$n` bind
 * values, never `replacements`. The tenant is bound as a parameter (D-05),
 * never interpolated. The INSERT's result was never read, so `type: "SELECT"`
 * changes nothing it returns.
 *
 * ai.service.test.js and ai.ragReach.az02 keep proving the statements' text,
 * the tenant predicate and the AZ-02 source-type filter.
 */
interface QueryOptions {
  type?: string;
  bind?: unknown[];
  replacements?: unknown;
}

const mockQuery = jest.fn();
jest.mock("../../config", () => ({ db: { query: mockQuery, QueryTypes: { SELECT: "SELECT" } } }));
jest.mock("../../models", () => ({
  TenantSettings: { findAll: jest.fn().mockResolvedValue([{ key: "ai_api_key", value: "k" }]) },
  DocumentChunk: { destroy: jest.fn().mockResolvedValue(0) },
}));
jest.mock("axios", () => ({
  post: jest.fn().mockResolvedValue({ data: { data: [{ embedding: [0.1, 0.2] }] } }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const ai = require("../../services/ai.service") as {
  ingestDocument: (tenantId: string, doc: { sourceType: string; sourceId: string; content: string }) => Promise<unknown>;
  retrieveContext: (tenantId: string, vector: number[], limit?: number) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

describe("ai — the RAG store's statements are sent through sql()", () => {
  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue([]);
  });

  it("the chunk INSERT is sent as { type: SELECT, bind } with the tenant bound as $1", async () => {
    await ai.ingestDocument(TENANT, { sourceType: "SopDocument", sourceId: "s1", content: "one paragraph" });
    const [text, options] = (mockQuery.mock.calls as [string, QueryOptions][])[0] as [string, QueryOptions];
    expect(text).toContain("INSERT INTO document_chunks");
    expect(Object.keys(options).sort()).toEqual(["bind", "type"]);
    expect(options.type).toBe("SELECT");
    expect(options.bind?.[0]).toBe(TENANT);
    expect(text).not.toContain(TENANT);
  });

  it("the similarity SELECT is sent as { type: SELECT, bind } with the tenant bound as $2", async () => {
    await ai.retrieveContext(TENANT, [0.1, 0.2], 3);
    const [text, options] = (mockQuery.mock.calls as [string, QueryOptions][])[0] as [string, QueryOptions];
    expect(Object.keys(options).sort()).toEqual(["bind", "type"]);
    expect(options.type).toBe("SELECT");
    expect(options.bind?.[1]).toBe(TENANT);
    expect(text).toContain("tenant_id = $2");
    expect(text).not.toContain(TENANT);
  });
});
