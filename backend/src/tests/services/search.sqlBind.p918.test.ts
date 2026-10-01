/**
 * P9-18 (search, its own change before the conversion): the search's raw SQL
 * goes through the bind-only helper `sql()` (utils/sql.util, P9-07).
 *
 * The FTS and ILIKE statements used `sequelize.query` with named
 * `replacements` (`:q`, `:tenantId`, `:limit`, `:like`), which a TypeScript
 * module may not do (P9-07's lint rule). Now each is sent with `bind` values
 * for `$1…$n`, never `replacements`, and the tenant predicate is BOUND
 * (`tenant_id = $n`, the D-05 rule for helper statements) to the caller's
 * tenant, never interpolated.
 *
 * search.service.test.js keeps proving the ranking, fallback and limits;
 * search.twoTenants.a56 keeps proving tenant B's rows never reach tenant A.
 */
interface QueryOptions {
  type?: string;
  bind?: unknown[];
  replacements?: unknown;
}

const mockQuery = jest.fn();
jest.mock("../../config", () => ({ db: { query: mockQuery } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const search = require("../../services/search.service") as {
  search: (tenantId: string, q: { q: string; types?: string[]; limit?: number }) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

describe("search — every statement is bound, the tenant predicate included", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it.each([
    ["FTS", false],
    ["ILIKE fallback", true],
  ])("the %s statement binds the tenant, the term and the limit", async (_label, failFts) => {
    mockQuery.mockImplementation((sql: string) => {
      if (failFts && sql.includes("search_vector")) {
        return Promise.reject(new Error('column "search_vector" does not exist'));
      }
      return Promise.resolve([]);
    });

    await search.search(TENANT, { q: "pump's", types: ["device"], limit: 7 });

    const calls = mockQuery.mock.calls as [string, QueryOptions][];
    const [sqlText, options] = calls[calls.length - 1] as [string, QueryOptions];
    expect(options).not.toHaveProperty("replacements");
    expect(options.type).toBe("SELECT");
    expect(Array.isArray(options.bind)).toBe(true);
    expect(sqlText).not.toMatch(/(?<!:):[a-zA-Z]/);
    const tenantParam = /\btenant_id = \$(\d+)/.exec(sqlText);
    expect(tenantParam).not.toBeNull();
    expect(options.bind?.[Number(tenantParam?.[1]) - 1]).toBe(TENANT);
    expect(options.bind).toContain(7);
    expect(sqlText).not.toContain("pump's");
  });
});
