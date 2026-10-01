/**
 * P6-11 (A-41 addendum, 2026-09-30) — the services the owner put in scope
 * write their audit row INSIDE the mutation's transaction.
 *
 * Before this card, none of these writes produced an audit row: kanban,
 * tickets, CMS content, feature flags, warehouses/storage locations and usage
 * alerts (tests/guards/auditCoverage.p611.test.ts lists why the rest of the
 * fifteen needed no change, or none of this kind).
 *
 * For each mutating route, through the REAL router, gates, validators,
 * controller, service, audit service and models (fixtures/memoryDb):
 *
 *  1. it commits EXACTLY the expected audit rows (one; two for a feature
 *     flag, which A-165 records under PLATFORM and under the affected tenant),
 *     in the same transaction as the entity write, naming the actor;
 *  2. a FORCED ROLLBACK — the audit row is written, then the transaction
 *     fails — commits neither the audit row nor the entity write.
 *
 * Kanban and tickets claim a number in raw SQL; `onQuery` answers it. The
 * socket is not started, so emitToBoard emits nothing.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";
import type AuditService from "../../services/audit.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const auditService = jest.requireActual<typeof AuditService>("../../services/audit.service");

const routers: Record<string, unknown> = {
  kanban: jest.requireActual<object>("../../routes/api/kanban.route"),
  tickets: jest.requireActual<object>("../../routes/api/tickets.route"),
  content: jest.requireActual<object>("../../routes/api/content.route"),
  featureFlags: jest.requireActual<object>("../../routes/api/featureFlags.route"),
  warehouse: jest.requireActual<object>("../../routes/api/warehouse.route"),
  meteredBilling: jest.requireActual<object>("../../routes/api/meteredBilling.route"),
};

const id = (n: number): string => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = id(1);
const TODO = id(2);
const DOING = id(3);
const DONE = id(4);
const SPRINT = id(5);
const LABEL = id(6);
const MEMBER = id(7);
const CARD = id(8);
const CARD2 = id(9);
const RELATION = id(10);
const TICKET = id(11);
const POST = id(12);
const CATEGORY = id(13);
const WAREHOUSE = id(14);
const LOCATION = id(15);
const ALERT = id(16);

let fx: TwoTenantWorld;
let owner: Principal;
let colleague: Principal;

type Who = "owner" | "superAdmin";

/** One mutating route and what it must commit. */
interface Case {
  readonly name: string;
  readonly router: keyof typeof routers;
  readonly method: string;
  readonly path: () => string;
  readonly body?: () => unknown;
  readonly who?: Who;
  /** The entity model the route writes. */
  readonly model: string;
  readonly action: "CREATE" | "UPDATE" | "DELETE";
  readonly resourceType: string;
  /** Audit rows committed (default 1). */
  readonly rows?: number;
}

const CASES: readonly Case[] = [
  // ---- kanban ----
  { name: "kanban: create project", router: "kanban", method: "POST", path: () => "/projects", body: () => ({ name: "New board" }), model: "KanbanProject", action: "CREATE", resourceType: "KanbanProject" },
  { name: "kanban: update project", router: "kanban", method: "PATCH", path: () => `/projects/${P}`, body: () => ({ name: "Renamed" }), model: "KanbanProject", action: "UPDATE", resourceType: "KanbanProject" },
  { name: "kanban: delete project", router: "kanban", method: "DELETE", path: () => `/projects/${P}`, model: "KanbanProject", action: "DELETE", resourceType: "KanbanProject" },
  { name: "kanban: add member", router: "kanban", method: "POST", path: () => `/projects/${P}/members`, body: () => ({ userId: colleague.id, accessLevel: "editor" }), model: "KanbanProjectMember", action: "CREATE", resourceType: "KanbanProjectMember" },
  { name: "kanban: update member", router: "kanban", method: "PATCH", path: () => `/projects/${P}/members/${MEMBER}`, body: () => ({ accessLevel: "editor" }), model: "KanbanProjectMember", action: "UPDATE", resourceType: "KanbanProjectMember" },
  { name: "kanban: remove member", router: "kanban", method: "DELETE", path: () => `/projects/${P}/members/${MEMBER}`, model: "KanbanProjectMember", action: "DELETE", resourceType: "KanbanProjectMember" },
  { name: "kanban: create column", router: "kanban", method: "POST", path: () => `/projects/${P}/columns`, body: () => ({ name: "Review" }), model: "KanbanColumn", action: "CREATE", resourceType: "KanbanColumn" },
  { name: "kanban: update column", router: "kanban", method: "PATCH", path: () => `/projects/${P}/columns/${DOING}`, body: () => ({ name: "In progress" }), model: "KanbanColumn", action: "UPDATE", resourceType: "KanbanColumn" },
  { name: "kanban: delete column", router: "kanban", method: "DELETE", path: () => `/projects/${P}/columns/${DOING}`, model: "KanbanColumn", action: "DELETE", resourceType: "KanbanColumn" },
  { name: "kanban: reorder columns", router: "kanban", method: "POST", path: () => `/projects/${P}/columns/reorder`, body: () => ({ order: [DOING, TODO, DONE] }), model: "KanbanColumn", action: "UPDATE", resourceType: "KanbanProject" },
  { name: "kanban: create card", router: "kanban", method: "POST", path: () => `/projects/${P}/cards`, body: () => ({ columnId: TODO, title: "Order spares" }), model: "KanbanCard", action: "CREATE", resourceType: "KanbanCard" },
  { name: "kanban: update card", router: "kanban", method: "PATCH", path: () => `/projects/${P}/cards/${CARD}`, body: () => ({ title: "Label every pump" }), model: "KanbanCard", action: "UPDATE", resourceType: "KanbanCard" },
  { name: "kanban: move card", router: "kanban", method: "PATCH", path: () => `/projects/${P}/cards/${CARD}/move`, body: () => ({ columnId: DOING, position: 0 }), model: "KanbanCard", action: "UPDATE", resourceType: "KanbanCard" },
  { name: "kanban: delete card", router: "kanban", method: "DELETE", path: () => `/projects/${P}/cards/${CARD}`, model: "KanbanCard", action: "DELETE", resourceType: "KanbanCard" },
  { name: "kanban: create label", router: "kanban", method: "POST", path: () => `/projects/${P}/labels`, body: () => ({ name: "blocked" }), model: "KanbanLabel", action: "CREATE", resourceType: "KanbanLabel" },
  { name: "kanban: update label", router: "kanban", method: "PATCH", path: () => `/projects/${P}/labels/${LABEL}`, body: () => ({ color: "#ff0000" }), model: "KanbanLabel", action: "UPDATE", resourceType: "KanbanLabel" },
  { name: "kanban: delete label", router: "kanban", method: "DELETE", path: () => `/projects/${P}/labels/${LABEL}`, model: "KanbanLabel", action: "DELETE", resourceType: "KanbanLabel" },
  { name: "kanban: create sprint", router: "kanban", method: "POST", path: () => `/projects/${P}/sprints`, body: () => ({ name: "Sprint 2" }), model: "KanbanSprint", action: "CREATE", resourceType: "KanbanSprint" },
  { name: "kanban: update sprint", router: "kanban", method: "PATCH", path: () => `/projects/${P}/sprints/${SPRINT}`, body: () => ({ status: "active" }), model: "KanbanSprint", action: "UPDATE", resourceType: "KanbanSprint" },
  { name: "kanban: delete sprint", router: "kanban", method: "DELETE", path: () => `/projects/${P}/sprints/${SPRINT}`, model: "KanbanSprint", action: "DELETE", resourceType: "KanbanSprint" },
  { name: "kanban: migrate cards", router: "kanban", method: "POST", path: () => `/projects/${P}/sprints/migrate`, body: () => ({ allNotDone: true, targetSprintId: SPRINT }), model: "KanbanCard", action: "UPDATE", resourceType: "KanbanProject" },
  { name: "kanban: add relation", router: "kanban", method: "POST", path: () => `/projects/${P}/cards/${CARD2}/relations`, body: () => ({ targetCardId: CARD, type: "relates_to" }), model: "KanbanCardRelation", action: "CREATE", resourceType: "KanbanCardRelation" },
  { name: "kanban: remove relation", router: "kanban", method: "DELETE", path: () => `/projects/${P}/cards/${CARD}/relations/${RELATION}`, model: "KanbanCardRelation", action: "DELETE", resourceType: "KanbanCardRelation" },
  // ---- tickets ----
  { name: "ticket: create", router: "tickets", method: "POST", path: () => "/", body: () => ({ subject: "Printer", description: "<p>jams</p>" }), model: "Ticket", action: "CREATE", resourceType: "Ticket" },
  { name: "ticket: update", router: "tickets", method: "PATCH", path: () => `/${TICKET}`, body: () => ({ priority: "high" }), model: "Ticket", action: "UPDATE", resourceType: "Ticket" },
  { name: "ticket: assign", router: "tickets", method: "POST", path: () => `/${TICKET}/assign`, body: () => ({ assignedTo: owner.id }), model: "Ticket", action: "UPDATE", resourceType: "Ticket" },
  { name: "ticket: delete", router: "tickets", method: "DELETE", path: () => `/${TICKET}`, model: "Ticket", action: "DELETE", resourceType: "Ticket" },
  { name: "ticket: comment", router: "tickets", method: "POST", path: () => `/${TICKET}/comments`, body: () => ({ body: "Any update?" }), model: "TicketComment", action: "CREATE", resourceType: "TicketComment" },
  // ---- content (CMS) ----
  { name: "content: create post", router: "content", method: "POST", path: () => "/posts", body: () => ({ title: "Recall notice", type: "NEWS", contentHtml: "<p>Body</p>" }), model: "Post", action: "CREATE", resourceType: "Post" },
  { name: "content: update post", router: "content", method: "PATCH", path: () => `/posts/${POST}`, body: () => ({ title: "Recall notice (rev 2)" }), model: "Post", action: "UPDATE", resourceType: "Post" },
  { name: "content: delete post", router: "content", method: "DELETE", path: () => `/posts/${POST}`, model: "Post", action: "DELETE", resourceType: "Post" },
  { name: "content: create category", router: "content", method: "POST", path: () => "/categories", body: () => ({ name: "Safety" }), model: "Category", action: "CREATE", resourceType: "Category" },
  { name: "content: update category", router: "content", method: "PATCH", path: () => `/categories/${CATEGORY}`, body: () => ({ name: "Safety notices" }), model: "Category", action: "UPDATE", resourceType: "Category" },
  { name: "content: delete category", router: "content", method: "DELETE", path: () => `/categories/${CATEGORY}`, model: "Category", action: "DELETE", resourceType: "Category" },
  // ---- feature flags (super admin, on tenant A: PLATFORM row + tenant row) ----
  { name: "featureFlag: set", router: "featureFlags", method: "POST", path: () => `/${fx.tenantA.id}/enable_mfa`, body: () => ({ enabled: true }), who: "superAdmin", model: "TenantSettings", action: "UPDATE", resourceType: "Tenant", rows: 2 },
  { name: "featureFlag: reset", router: "featureFlags", method: "DELETE", path: () => `/${fx.tenantA.id}/enable_iot`, who: "superAdmin", model: "TenantSettings", action: "UPDATE", resourceType: "Tenant", rows: 2 },
  { name: "featureFlag: initialize", router: "featureFlags", method: "POST", path: () => `/${fx.tenantA.id}/initialize`, who: "superAdmin", model: "TenantSettings", action: "UPDATE", resourceType: "Tenant", rows: 2 },
  // ---- warehouses and storage locations ----
  { name: "warehouse: create", router: "warehouse", method: "POST", path: () => "/", body: () => ({ name: "East store", code: "EAST" }), model: "Warehouse", action: "CREATE", resourceType: "Warehouse" },
  { name: "warehouse: update", router: "warehouse", method: "PATCH", path: () => `/${WAREHOUSE}`, body: () => ({ name: "Main store (north)" }), model: "Warehouse", action: "UPDATE", resourceType: "Warehouse" },
  { name: "warehouse: delete", router: "warehouse", method: "DELETE", path: () => `/${WAREHOUSE}`, model: "Warehouse", action: "DELETE", resourceType: "Warehouse" },
  { name: "location: create", router: "warehouse", method: "POST", path: () => "/locations", body: () => ({ warehouseId: WAREHOUSE, name: "Shelf B", code: "B1" }), model: "StorageLocation", action: "CREATE", resourceType: "StorageLocation" },
  { name: "location: update", router: "warehouse", method: "PATCH", path: () => `/locations/${LOCATION}`, body: () => ({ name: "Shelf A (top)" }), model: "StorageLocation", action: "UPDATE", resourceType: "StorageLocation" },
  { name: "location: delete", router: "warehouse", method: "DELETE", path: () => `/locations/${LOCATION}`, model: "StorageLocation", action: "DELETE", resourceType: "StorageLocation" },
  // ---- usage alerts ----
  { name: "usage alert: create", router: "meteredBilling", method: "POST", path: () => "/alerts", body: () => ({ metricName: "api_calls", threshold: 1000 }), model: "UsageAlert", action: "CREATE", resourceType: "UsageAlert" },
  { name: "usage alert: delete", router: "meteredBilling", method: "DELETE", path: () => `/alerts/${ALERT}`, model: "UsageAlert", action: "DELETE", resourceType: "UsageAlert" },
];

const seedWorld = (): void => {
  const a = fx.tenantA.id;
  mdb.seed("KanbanProject", { id: P, tenantId: a, name: "Ward rollout", code: "WR", createdBy: owner.id });
  mdb.seed("KanbanColumn", [
    { id: TODO, projectId: P, name: "To do", position: 0 },
    { id: DOING, projectId: P, name: "Doing", position: 1 },
    { id: DONE, projectId: P, name: "Done", position: 2, isDone: true },
  ]);
  mdb.seed("KanbanSprint", { id: SPRINT, projectId: P, name: "Sprint 1", status: "planned" });
  mdb.seed("KanbanLabel", { id: LABEL, projectId: P, name: "urgent" });
  mdb.seed("KanbanProjectMember", [
    { projectId: P, userId: owner.id, accessLevel: "owner" },
    { id: MEMBER, projectId: P, userId: colleague.id, accessLevel: "viewer" },
  ]);
  mdb.seed("KanbanCard", [
    { id: CARD, tenantId: a, projectId: P, columnId: TODO, title: "Label pumps", position: 0, createdBy: owner.id },
    { id: CARD2, tenantId: a, projectId: P, columnId: TODO, title: "Train staff", position: 1, createdBy: owner.id },
  ]);
  mdb.seed("KanbanCardRelation", [
    { id: RELATION, projectId: P, sourceCardId: CARD, targetCardId: CARD2, type: "blocks" },
    { projectId: P, sourceCardId: CARD2, targetCardId: CARD, type: "blocked_by" },
  ]);
  mdb.seed("Ticket", {
    id: TICKET, tenantId: a, number: 1, ticketKey: "TKT-1", subject: "Cannot print", status: "open",
    priority: "medium", category: "support", createdBy: owner.id,
  });
  mdb.seed("Post", { id: POST, title: "Recall notice", slug: "recall-notice", type: "NEWS", status: "DRAFT", contentHtml: "<p>x</p>" });
  mdb.seed("Category", { id: CATEGORY, name: "Safety", slug: "safety" });
  mdb.seed("TenantSettings", { tenantId: a, key: "feature_flag_enable_iot", value: "false" });
  mdb.seed("Warehouse", { id: WAREHOUSE, tenantId: a, name: "Main store", code: "MAIN", status: "active", isDeleted: false });
  mdb.seed("StorageLocation", { id: LOCATION, tenantId: a, warehouseId: WAREHOUSE, name: "Shelf A", code: "A1", isActive: true });
  mdb.seed("UsageAlert", { id: ALERT, tenantId: a, metricName: "api_calls", threshold: 500, comparison: "gte", notificationChannels: ["email"], isEnabled: true });
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  colleague = fx.principal(fx.tenantA, "TECHNICIAN");
  seedTenants(mdb, fx, [owner, colleague, fx.superAdmin]);
  seedWorld();
  // The two raw statements on these paths: kanban's card number and the
  // ticket counter. Both name their tenant (asserted by their own suites).
  mdb.onQuery((sql) => {
    if (sql.includes("card_seq")) {
      return [[{ card_seq: 3 }], 1];
    }
    if (sql.includes("ticket_counters")) {
      return [[{ seq: 2 }], 1];
    }
    throw new Error(`unexpected raw SQL: ${sql}`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const principalOf = (who: Who | undefined): Principal => (who === "superAdmin" ? fx.superAdmin : owner);

const send = (c: Case): ReturnType<typeof call> => {
  as(principalOf(c.who));
  return call(routers[c.router], c.method, c.path(), { body: c.body ? c.body() : {} });
};

describe("P6-11 — each mutation commits its audit row in its own transaction", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const res = await send(c);
    // A 2xx; on anything else the body is in the failure, so it names why.
    const ok = res.status >= 200 && res.status < 300;
    expect({ ok, status: res.status, body: ok ? null : res.body }).toMatchObject({ ok: true, body: null });

    const committed = mdb.committed();
    const audits = committed.filter((w) => w.model === "AuditLog");
    expect(audits).toHaveLength(c.rows ?? 1);
    const entityTx = new Set(committed.filter((w) => w.model === c.model).map((w) => w.tx));
    for (const audit of audits) {
      expect(audit.tx).not.toBeNull();
      expect(entityTx.has(audit.tx)).toBe(true);
    }

    const rows: Row[] = mdb.rows("AuditLog");
    const who = principalOf(c.who);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: c.action,
        resourceType: c.resourceType,
        userId: who.id,
        actorType: "user",
      });
    }
    const tenants = rows.map((r) => r["tenantId"]);
    expect(tenants).toContain(fx.tenantA.id);
  });
});

describe("P6-11 — a rolled-back mutation leaves no audit row", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const real = auditService.logAction.bind(auditService);
    jest.spyOn(auditService, "logAction").mockImplementation(async (entry, options) => {
      await real(entry, options);
      throw new Error("forced rollback after the audit row was written");
    });

    const res = await send(c);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const committed = mdb.committed();
    expect(committed.filter((w) => w.model === "AuditLog")).toEqual([]);
    expect(committed.filter((w) => w.model === c.model)).toEqual([]);
    // The row WAS written — inside the transaction that rolled back.
    expect(mdb.writes().some((w) => w.model === "AuditLog")).toBe(true);
  });
});
