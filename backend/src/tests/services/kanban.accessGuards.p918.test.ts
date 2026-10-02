/**
 * P9-18 (the kanban conversion's planted-defect gate): three guards no suite
 * watched. Each was found by a planted defect that every kanban suite passed.
 *
 *  - The project lookup carries `tenantId: user.tenantId` EXPLICITLY. A super
 *    admin's context skips the tenant hooks, so without it a super admin
 *    signed in to one tenant opened another tenant's board.
 *  - A caller with NO access to a project in their own tenant gets 404, not
 *    403: a 403 would confirm the board exists. 403 is kept for a member whose
 *    level is too low.
 *  - A card is looked up inside the project in the path: moving a card of
 *    another project (same tenant) through this project's URL is a 404.
 *
 * The model fakes honour every key of the `where` they are given, as an
 * unscoped query would (no tenant hook adds anything).
 */
type Row = Record<string, unknown>;
type Where = Record<PropertyKey, unknown>;

const TENANT_A = "5ea5c400-0000-4000-8000-0000000000a1";
const TENANT_B = "5ea5c400-0000-4000-8000-0000000000b2";
const PROJECT_A = "5ea5c400-0000-4000-8000-0000000000f1";
const PROJECT_A2 = "5ea5c400-0000-4000-8000-0000000000f2";
const CARD_OF_A2 = "5ea5c400-0000-4000-8000-0000000000c2";
const COLUMN_A = "5ea5c400-0000-4000-8000-0000000000d1";

const projects: Row[] = [
  { id: PROJECT_A, tenantId: TENANT_A, name: "Alpha", code: "ALP", createdBy: "owner-a" },
  { id: PROJECT_A2, tenantId: TENANT_A, name: "Alpha two", code: "AL2", createdBy: "owner-a" },
];
const cards: Row[] = [{ id: CARD_OF_A2, projectId: PROJECT_A2, columnId: COLUMN_A, position: 0 }];
const columns: Row[] = [{ id: COLUMN_A, projectId: PROJECT_A, name: "To Do", position: 0 }];

/** The rows whose plain keys all equal the `where`'s (Op keys are symbols, not checked). */
const matching = (rows: Row[], where: Where): Row[] =>
  rows.filter((r) => Object.keys(where).every((k) => r[k] === where[k]));

const mockMembers = jest.fn<Promise<Row[]>, []>();

jest.mock("../../models", () => ({
  sequelize: { query: jest.fn(), transaction: (fn: (t: string) => Promise<unknown>) => fn("txn") },
  KanbanProject: { findOne: (o: { where: Where }) => Promise.resolve(matching(projects, o.where)[0] ?? null) },
  KanbanProjectMember: { findAll: () => mockMembers() },
  KanbanCard: { findOne: (o: { where: Where }) => Promise.resolve(matching(cards, o.where)[0] ?? null) },
  KanbanColumn: { findOne: (o: { where: Where }) => Promise.resolve(matching(columns, o.where)[0] ?? null) },
  User: { count: jest.fn() },
}));
jest.mock("../../config/socket", () => ({ emitToBoard: jest.fn() }));
jest.mock("../../services/notification.service", () => ({ emitNotification: jest.fn() }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

interface Kanban {
  getProject: (user: Row, projectId: string) => Promise<unknown>;
  assertAccess: (user: Row, projectId: string, minLevel?: string) => Promise<unknown>;
  moveCard: (user: Row, projectId: string, cardId: string, move: { columnId: string; position: number }) => Promise<unknown>;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const kanban = require("../../services/kanban.service") as Kanban;

const SUPER_IN_B = { id: "sa", tenantId: TENANT_B, role: { name: "SUPER_ADMIN" } };
const OWNER_A = { id: "owner-a", tenantId: TENANT_A, role: { name: "USER" } };
const STRANGER_A = { id: "stranger-a", tenantId: TENANT_A, role: { name: "USER" } };
const VIEWER_A = { id: "viewer-a", tenantId: TENANT_A, role: { name: "USER" } };

beforeEach(() => mockMembers.mockReset().mockResolvedValue([]));

describe("kanban — access guards (P9-18)", () => {
  it("a super admin signed in to another tenant cannot open the board: 404", async () => {
    await expect(kanban.getProject(SUPER_IN_B, PROJECT_A)).rejects.toMatchObject({ status: 404, message: "Project not found" });
  });

  it("a same-tenant user with no access gets 404, not 403", async () => {
    await expect(kanban.assertAccess(STRANGER_A, PROJECT_A, "viewer")).rejects.toMatchObject({ status: 404 });
    await expect(kanban.assertAccess(STRANGER_A, PROJECT_A, "editor")).rejects.toMatchObject({ status: 404 });
  });

  it("a member below the level asked for gets 403", async () => {
    mockMembers.mockResolvedValue([{ projectId: PROJECT_A, userId: "viewer-a", accessLevel: "viewer" }]);
    await expect(kanban.assertAccess(VIEWER_A, PROJECT_A, "editor")).rejects.toMatchObject({ status: 403 });
  });

  it("a card of another project cannot be moved through this project's URL: 404", async () => {
    await expect(kanban.moveCard(OWNER_A, PROJECT_A, CARD_OF_A2, { columnId: COLUMN_A, position: 0 })).rejects.toMatchObject({
      status: 404,
      message: "Card not found",
    });
  });
});
