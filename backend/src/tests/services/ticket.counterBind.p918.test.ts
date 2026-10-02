/**
 * P9-18 (ticket, its own change before the conversion): the per-tenant ticket
 * counter goes through the bind-only helper `sql()` (utils/sql.util, P9-07).
 *
 * The upsert used `sequelize.query` with a named `:tenantId` replacement,
 * which a TypeScript module may not do (P9-07's lint rule). Now the tenant is
 * BOUND (`$1`, D-05: the INSERT's tenant column takes a bound value), the
 * statement runs in the create's transaction, and `type: "SELECT"` answers the
 * RETURNING row directly.
 */
interface QueryOptions {
  type?: string;
  bind?: unknown[];
  replacements?: unknown;
  transaction?: unknown;
}

const mockQuery = jest.fn();
const mockCreate = jest.fn();

jest.mock("../../models", () => ({
  sequelize: {
    query: mockQuery,
    transaction: (fn: (t: string) => Promise<unknown>) => fn("txn"),
  },
  Ticket: {
    create: mockCreate,
    findOne: jest.fn().mockResolvedValue({ id: "t1", createdBy: "u1", assignedTo: null, comments: [] }),
  },
  TicketComment: {},
  User: { findOne: jest.fn() },
  Tenant: {},
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/notification.service", () => ({ emitNotification: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const tickets = require("../../services/ticket.service") as {
  createTicket: (user: Record<string, unknown>, data: Record<string, unknown>) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

describe("ticket — the counter upsert is sent through sql()", () => {
  it("binds the tenant as $1, runs in the create's transaction, and numbers the ticket from its row", async () => {
    mockQuery.mockReset().mockResolvedValue([{ seq: 7 }]);
    mockCreate.mockReset().mockImplementation((values: Record<string, unknown>) =>
      Promise.resolve({ ...values, id: "t1", tenantId: TENANT }),
    );

    await tickets.createTicket(
      { id: "u1", tenantId: TENANT, role: { name: "USER" } },
      { subject: "Printer", description: "<p>x</p>" },
    );

    const [text, options] = (mockQuery.mock.calls as [string, QueryOptions][])[0] as [string, QueryOptions];
    expect(text).toContain("INSERT INTO ticket_counters");
    expect(options).not.toHaveProperty("replacements");
    expect(options.type).toBe("SELECT");
    expect(options.bind).toEqual([TENANT]);
    // The tenant column's value IS the bound $1 (not a literal).
    expect(text).toMatch(/VALUES \(gen_random_uuid\(\), \$1, 1,/);
    expect(options.transaction).toBe("txn");
    expect(text).not.toContain(TENANT);
    const [[values]] = mockCreate.mock.calls as [[{ number: number; ticketKey: string }]];
    expect(values.number).toBe(7);
    expect(values.ticketKey).toBe("TKT-7");
  });
});
