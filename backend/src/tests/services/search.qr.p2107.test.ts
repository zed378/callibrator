/**
 * P21-07 (F-72) — the quick search finds a device by its QR code. A QR code ("TST000001") is one
 * token the English full-text search would not match as typed, so the device statement matches
 * `qr_code` EXACTLY (upper-cased, the stored form — P21-02a's `normaliseQrCode`) beside the text
 * match and ranks that row first; the ILIKE fallback searches the column too. The other types are
 * unchanged. The statement runs on PostgreSQL 18 in `dashboard.twoFacility.p2107.live`.
 */
interface QueryOptions {
  bind?: unknown[];
}

const mockQuery = jest.fn();
jest.mock("../../config", () => ({ db: { query: mockQuery } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const search = require("../../services/search.service") as {
  search: (tenantId: string, q: { q: string; types?: string[]; limit?: number }) => Promise<{ results: Record<string, unknown>[] }>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

beforeEach(() => {
  mockQuery.mockReset();
});

describe("F-72 — a device by its QR code", () => {
  it("the device FTS statement matches qr_code exactly (upper-cased) and ranks it first; the term stays bound", async () => {
    mockQuery.mockResolvedValue([]);
    await search.search(TENANT, { q: "tst000001", types: ["device"] });
    const [sqlText, options] = mockQuery.mock.calls[0] as [string, QueryOptions];
    expect(sqlText).toContain("CASE WHEN \"qr_code\" = upper($1) THEN 1 ELSE ts_rank(\"search_vector\", plainto_tsquery('english', $1)) END AS rank");
    expect(sqlText).toContain("(\"search_vector\" @@ plainto_tsquery('english', $1) OR \"qr_code\" = upper($1))");
    expect(sqlText).toContain("qr_code AS \"qrCode\"");
    expect(options.bind).toEqual(["tst000001", TENANT, 10]);
    expect(sqlText).not.toContain("tst000001");
  });

  it("the ILIKE fallback searches qr_code too", async () => {
    mockQuery.mockImplementation((sql: string) => (sql.includes("search_vector") ? Promise.reject(new Error("no column")) : Promise.resolve([])));
    await search.search(TENANT, { q: "TST000001", types: ["device"] });
    const [sqlText] = mockQuery.mock.calls[1] as [string];
    expect(sqlText).toContain("\"qr_code\" ILIKE $2");
  });

  it("the other types keep the plain text match", async () => {
    mockQuery.mockResolvedValue([]);
    await search.search(TENANT, { q: "pump", types: ["stock", "certificate"] });
    for (const [sqlText] of mockQuery.mock.calls as [string][]) {
      expect(sqlText).not.toContain("qr_code");
      expect(sqlText).toContain("ts_rank(\"search_vector\", plainto_tsquery('english', $1)) AS rank");
    }
  });
});
