/**
 * P9-18 (webhook, its own change before the conversion): the delivery claim
 * goes through the bind-only helper `sql()` (utils/sql.util, P9-07).
 *
 * The claim used `db.query` with named `replacements` (`:leaseSeconds`,
 * `:limit`, `:id`, `:tenantId`), which a TypeScript module may not do. Now it
 * is sent with `bind` values for `$1…$n` and `type: "SELECT"`, which answers
 * the RETURNING rows directly. For a single delivery (the request-path first
 * attempt), the tenant predicate is BOUND (`tenant_id = $n`, D-05). The
 * dispatcher's claim stays cross-tenant on purpose (ADR-054, W-12).
 *
 * webhook.delivery.a10 keeps proving the claim/lease/backoff behaviour;
 * webhook.durable.a10.live proves the statement on PostgreSQL.
 */
interface QueryOptions {
  type?: string;
  bind?: unknown[];
  replacements?: unknown;
}

const mockQuery = jest.fn();
jest.mock("../../config", () => ({ db: { query: mockQuery, transaction: jest.fn() } }));
jest.mock("../../models", () => ({ Webhook: {}, WebhookDelivery: {} }));
jest.mock("../../services/kms.service", () => ({ encryptData: jest.fn(), decryptData: jest.fn() }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const webhook = require("../../services/webhook.service") as {
  _claim: (opts?: { id?: string | null; tenantId?: string | null; limit?: number }) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";
const DELIVERY = "5ea5c400-0000-4000-8000-00000000d001";

describe("webhook — the delivery claim is sent through sql()", () => {
  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue([{ id: DELIVERY, tenantId: TENANT }]);
  });

  it("a single-delivery claim binds its id and tenant, and answers the RETURNING rows", async () => {
    const rows = await webhook._claim({ id: DELIVERY, tenantId: TENANT });
    expect(rows).toEqual([{ id: DELIVERY, tenantId: TENANT }]);
    const [text, options] = (mockQuery.mock.calls as [string, QueryOptions][])[0] as [string, QueryOptions];
    expect(options).not.toHaveProperty("replacements");
    expect(options.type).toBe("SELECT");
    const tenantParam = /\btenant_id = \$(\d+)/.exec(text);
    const idParam = /\bid = \$(\d+)/.exec(text);
    expect(tenantParam).not.toBeNull();
    expect(idParam).not.toBeNull();
    expect(options.bind?.[Number(tenantParam?.[1]) - 1]).toBe(TENANT);
    expect(options.bind?.[Number(idParam?.[1]) - 1]).toBe(DELIVERY);
    expect(text).not.toMatch(/(?<!:):[a-zA-Z]/);
  });

  it("the dispatcher's claim binds the lease and the batch limit, and names no tenant", async () => {
    await webhook._claim({ limit: 7 });
    const [text, options] = (mockQuery.mock.calls as [string, QueryOptions][])[0] as [string, QueryOptions];
    expect(options).not.toHaveProperty("replacements");
    expect(options.type).toBe("SELECT");
    expect(options.bind).toContain(7);
    expect(text).not.toContain("tenant_id =");
  });
});
