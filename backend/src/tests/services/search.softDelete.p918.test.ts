/**
 * P9-18 (search): every search statement filters soft-deleted rows.
 *
 * Found by a planted defect during the conversion. Removing the soft-delete
 * predicate from the FTS statement left every unit suite green: nothing
 * pinned it (the live probe did catch it). The expected predicate for each
 * table is written out here by hand. It is not read from the service's own
 * table of types, so deleting or changing an entry there fails this test.
 */
interface QueryOptions {
  bind?: unknown[];
}

const mockQuery = jest.fn();
jest.mock("../../config", () => ({ db: { query: mockQuery } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const search = require("../../services/search.service") as {
  search: (tenantId: string, q: { q: string; types?: string[] }) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

const EXPECTED: [string, string, string][] = [
  ["device", "calibration_devices", "is_deleted = false"],
  ["stock", "stocks", "is_deleted = false"],
  ["certificate", "certificates", "deleted_at IS NULL"],
];

describe("search — soft-deleted rows are never matched", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it.each(EXPECTED)("the FTS statement for %s (%s) carries `%s`", async (type, table, predicate) => {
    mockQuery.mockResolvedValue([]);

    await search.search(TENANT, { q: "pump", types: [type] });

    const calls = mockQuery.mock.calls as [string, QueryOptions][];
    expect(calls).toHaveLength(1);
    const [sqlText] = calls[0] as [string, QueryOptions];
    expect(sqlText).toContain(`FROM "${table}"`);
    expect(sqlText).toContain("search_vector");
    expect(sqlText).toContain(` AND ${predicate} `);
  });

  it.each(EXPECTED)("the ILIKE fallback for %s (%s) carries `%s`", async (type, table, predicate) => {
    mockQuery.mockImplementation((sql: string) =>
      sql.includes("search_vector")
        ? Promise.reject(new Error('column "search_vector" does not exist'))
        : Promise.resolve([]));

    await search.search(TENANT, { q: "pump", types: [type] });

    const calls = mockQuery.mock.calls as [string, QueryOptions][];
    const [sqlText] = calls[calls.length - 1] as [string, QueryOptions];
    expect(sqlText).toContain(`FROM "${table}"`);
    expect(sqlText).toContain("ILIKE");
    expect(sqlText).toContain(` AND ${predicate} AND (`);
  });
});
