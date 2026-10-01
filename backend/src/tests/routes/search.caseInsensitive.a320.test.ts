/**
 * A-320 — the warehouse, stock and ticket searches match regardless of case.
 *
 * Each built `%${term.toLowerCase()}%` and matched it with `Op.like`, which is
 * case-sensitive on PostgreSQL: a warehouse named "Main Store", an item "Fuse
 * 5A" or a ticket "TKT-7" was not found by typing its own name. Now each
 * matches with `Op.iLike` (ILIKE) on the term as typed. A leading `%` rules
 * out a b-tree index either way, so nothing that used an index is lost.
 *
 * REAL routers, validators, controllers, services and models on memoryDb,
 * whose query double evaluates `Op.like` case-sensitively and `Op.iLike`
 * case-insensitively, as PostgreSQL does.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as WarehouseRoute from "../../routes/api/warehouse.route";
import type * as StockRoute from "../../routes/api/stock.route";
import type * as TicketRoute from "../../routes/api/tickets.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const warehouseRouter = jest.requireActual<typeof WarehouseRoute>("../../routes/api/warehouse.route");
const stockRouter = jest.requireActual<typeof StockRoute>("../../routes/api/stock.route");
const ticketRouter = jest.requireActual<typeof TicketRoute>("../../routes/api/tickets.route");

const WAREHOUSE = "a1000000-0000-4000-8000-000000000320";
let admin: Principal;

/** The ids (or keys) a list answer carries in `data`. */
const found = (body: unknown, field: string): unknown[] => {
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data.map((row) => (row as Record<string, unknown>)[field]) : [];
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  const tenantId = fx.tenantA.id;
  mdb.seed("Warehouse", [
    { id: WAREHOUSE, tenantId, name: "Main Store", code: "WH-MAIN" },
    { id: "a1000000-0000-4000-8000-000000000321", tenantId, name: "ward cupboard", code: "wh-ward" },
  ]);
  mdb.seed("Stock", [
    { id: "a2000000-0000-4000-8000-000000000320", tenantId, warehouseId: WAREHOUSE, itemName: "Fuse 5A", sku: "FUSE-5A", quantity: 3 },
    { id: "a2000000-0000-4000-8000-000000000321", tenantId, warehouseId: WAREHOUSE, itemName: "gauze roll", sku: "gz-1", quantity: 9 },
  ]);
  mdb.seed("Ticket", [
    { id: "a3000000-0000-4000-8000-000000000320", tenantId, number: 7, ticketKey: "TKT-7", subject: "Printer Offline", status: "open", priority: "medium", category: "support", createdBy: admin.id },
    { id: "a3000000-0000-4000-8000-000000000321", tenantId, number: 8, ticketKey: "TKT-8", subject: "login loop", status: "open", priority: "medium", category: "support", createdBy: admin.id },
  ]);
  as(admin);
});

describe("A-320 — warehouse search is case-insensitive", () => {
  it.each(["Main", "main", "MAIN", "wh-main", "WARD"])("GET /?find=%s finds the warehouse", async (find) => {
    const res = await call(warehouseRouter, "GET", "/", { query: { find } });
    expect(res.status).toBe(200);
    expect(found(res.body, "code")).toEqual([find.toLowerCase() === "ward" ? "wh-ward" : "WH-MAIN"]);
  });
});

describe("A-320 — stock search is case-insensitive", () => {
  it.each([
    ["Fuse", "Fuse 5A"],
    ["fuse", "Fuse 5A"],
    ["fuse-5a", "Fuse 5A"],
    ["GAUZE", "gauze roll"],
  ])("GET /?find=%s finds %s", async (find, itemName) => {
    const res = await call(stockRouter, "GET", "/", { query: { find } });
    expect(res.status).toBe(200);
    expect(found(res.body, "itemName")).toEqual([itemName]);
  });
});

describe("A-320 — ticket search is case-insensitive", () => {
  it.each([
    ["Printer", "TKT-7"],
    ["printer offline", "TKT-7"],
    ["TKT-7", "TKT-7"],
    ["tkt-8", "TKT-8"],
    ["LOGIN", "TKT-8"],
  ])("GET /?q=%s finds %s", async (q, ticketKey) => {
    const res = await call(ticketRouter, "GET", "/", { query: { q } });
    expect(res.status).toBe(200);
    expect(found(res.body, "ticketKey")).toEqual([ticketKey]);
  });

  it("control: a term that matches nothing still finds nothing", async () => {
    const res = await call(ticketRouter, "GET", "/", { query: { q: "no such ticket" } });
    expect(res.status).toBe(200);
    expect(found(res.body, "ticketKey")).toEqual([]);
  });
});
