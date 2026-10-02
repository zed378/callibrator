/**
 * P9-18 (kanban, its own change before the conversion): the per-project card
 * number bump goes through the bind-only helper `sql()` (utils/sql.util, P9-07).
 *
 * The UPDATE used `sequelize.query` with named `replacements`
 * (`:projectId`, `:tenantId`), which a TypeScript module may not do. Now it is
 * sent with `bind` values, the project's tenant BOUND (`tenant_id = $2`,
 * D-05), in the card's transaction, and `type: "SELECT"` answers the
 * RETURNING rows directly. A statement that updates no row is still a 404.
 */
interface QueryOptions {
  type?: string;
  bind?: unknown[];
  replacements?: unknown;
  transaction?: unknown;
}

const mockQuery = jest.fn();
const PROJECT = "5ea5c400-0000-4000-8000-0000000000f1";
const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

jest.mock("../../models", () => ({
  sequelize: { query: mockQuery, transaction: (fn: (t: string) => Promise<unknown>) => fn("txn") },
  KanbanProject: {
    findOne: jest.fn().mockResolvedValue({ id: "5ea5c400-0000-4000-8000-0000000000f1", tenantId: "5ea5c400-0000-4000-8000-0000000000a1", code: "PRJ", name: "P", createdBy: "u1" }),
  },
  KanbanProjectMember: { findOne: jest.fn().mockResolvedValue(null) },
  KanbanColumn: { findOne: jest.fn().mockResolvedValue({ id: "col1" }) },
  KanbanCard: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
  KanbanSprint: { findOne: jest.fn() },
  User: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock("../../config/socket", () => ({ emitToBoard: jest.fn() }));
jest.mock("../../services/notification.service", () => ({ emitNotification: jest.fn() }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const kanban = require("../../services/kanban.service") as {
  createCard: (user: Record<string, unknown>, projectId: string, data: Record<string, unknown>) => Promise<unknown>;
};

const SUPER = { id: "sa", tenantId: "t0", role: { name: "SUPERADMIN" } };

describe("kanban — the card_seq bump is sent through sql()", () => {
  it("binds the project and its tenant, runs in the card's transaction, and a missed row is a 404", async () => {
    mockQuery.mockReset().mockResolvedValue([]);

    await expect(kanban.createCard(SUPER, PROJECT, { columnId: "col1", title: "T" })).rejects.toMatchObject({ status: 404 });

    const [text, options] = (mockQuery.mock.calls as [string, QueryOptions][])[0] as [string, QueryOptions];
    expect(text).toContain("UPDATE kanban_projects SET card_seq = card_seq + 1");
    expect(options).not.toHaveProperty("replacements");
    expect(options.type).toBe("SELECT");
    expect(options.transaction).toBe("txn");
    const tenantParam = /\btenant_id = \$(\d+)/.exec(text);
    const idParam = /\bid = \$(\d+)/.exec(text);
    expect(options.bind?.[Number(tenantParam?.[1]) - 1]).toBe(TENANT);
    expect(options.bind?.[Number(idParam?.[1]) - 1]).toBe(PROJECT);
  });
});
