/**
 * Q-51 (ADR-100 Amendment 2) — the stock adjustment and transfer lists name
 * the API key that wrote a row: id, name and display prefix ONLY (never
 * `keyHash`), as a LEFT JOIN (a user-written row is still listed), tenant
 * scoped (another tenant's key reads as null), and a revoked (soft-deleted)
 * key still names its rows. Before, a key-written row read with no actor.
 *
 * The real stock router, service, models and tenant hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as StockRoutes from "../../routes/api/stock.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const stock = jest.requireActual<typeof StockRoutes>("../../routes/api/stock.route");

const KEY_ID = "ab000000-0000-4000-8000-0000000000f1";
const REVOKED_KEY_ID = "ab000000-0000-4000-8000-0000000000f2";
const FOREIGN_KEY_ID = "ab000000-0000-4000-8000-0000000000f3";
const WH_A = "a5400000-0000-4000-8000-000000000001";
const WH_B = "a5400000-0000-4000-8000-000000000002";
const HASH = "e".repeat(64);
const KEY_VIEW = { id: KEY_ID, name: "ERP sync", keyPrefix: "cbk_aaaaaa" };

interface ActorRow {
  id: string;
  apiKey: Record<string, unknown> | null;
  adjuster?: { id: string } | null;
  requester?: { id: string } | null;
}

let fx: TwoTenantWorld;
let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  const tenantId = fx.tenantA.id;
  const key = { tenantId, keyHash: HASH, scopes: [] };
  mdb.seed("ApiKey", [
    { ...key, id: KEY_ID, name: "ERP sync", keyPrefix: "cbk_aaaaaa", isActive: true, isDeleted: false },
    { ...key, id: REVOKED_KEY_ID, name: "Old scanner", keyPrefix: "cbk_bbbbbb", isActive: false, isDeleted: true },
    { ...key, id: FOREIGN_KEY_ID, tenantId: fx.tenantB.id, name: "Other", keyPrefix: "cbk_cccccc", isActive: true, isDeleted: false },
  ]);
  mdb.seed("Warehouse", [
    { id: WH_A, tenantId, name: "Main", code: "WH-R-A", status: "active" },
    { id: WH_B, tenantId, name: "Ward", code: "WH-R-B", status: "active" },
  ]);
  mdb.seed("StockAdjustment", [
    { id: "a5400000-0000-4000-8000-0000000000a1", tenantId, warehouseId: WH_A, type: "addition", quantity: 1, adjustedBy: null, apiKeyId: KEY_ID },
    { id: "a5400000-0000-4000-8000-0000000000a2", tenantId, warehouseId: WH_A, type: "addition", quantity: 1, adjustedBy: admin.id, apiKeyId: null },
    { id: "a5400000-0000-4000-8000-0000000000a3", tenantId, warehouseId: WH_A, type: "addition", quantity: 1, adjustedBy: null, apiKeyId: REVOKED_KEY_ID },
    { id: "a5400000-0000-4000-8000-0000000000a4", tenantId, warehouseId: WH_A, type: "addition", quantity: 1, adjustedBy: null, apiKeyId: FOREIGN_KEY_ID },
  ]);
  mdb.seed("StockTransfer", [
    { id: "a5400000-0000-4000-8000-0000000000b1", tenantId, fromWarehouseId: WH_A, toWarehouseId: WH_B, itemName: "Fuse", quantity: 1, status: "pending", requestedBy: null, apiKeyId: KEY_ID },
    { id: "a5400000-0000-4000-8000-0000000000b2", tenantId, fromWarehouseId: WH_A, toWarehouseId: WH_B, itemName: "Fuse", quantity: 1, status: "pending", requestedBy: admin.id, apiKeyId: null },
  ]);
});

const list = async (path: string): Promise<{ rows: ActorRow[]; text: string }> => {
  as(admin);
  const res = await call(stock, "GET", path);
  expect(res.status).toBe(200);
  return { rows: (res.body as { data: ActorRow[] }).data, text: JSON.stringify(res.body) };
};

const byId = (rows: ActorRow[], suffix: string): ActorRow | undefined => rows.find((r) => r.id.endsWith(suffix));

it("GET /adjustment/history: the key (never the hash), the user's row, a revoked key, and no foreign key", async () => {
  const { rows, text } = await list("/adjustment/history");
  expect(rows).toHaveLength(4);
  expect(byId(rows, "a1")?.apiKey).toEqual(KEY_VIEW);
  expect(byId(rows, "a2")?.apiKey).toBeNull();
  expect(byId(rows, "a2")?.adjuster?.id).toBe(admin.id);
  expect(byId(rows, "a3")?.apiKey).toEqual({ id: REVOKED_KEY_ID, name: "Old scanner", keyPrefix: "cbk_bbbbbb" });
  expect(byId(rows, "a4")?.apiKey).toBeNull();
  expect(text).not.toContain(HASH);
});

it("GET /transfer/history: the key names the requester; the user's row is unchanged", async () => {
  const { rows, text } = await list("/transfer/history");
  expect(byId(rows, "b1")?.apiKey).toEqual(KEY_VIEW);
  expect(byId(rows, "b2")?.apiKey).toBeNull();
  expect(byId(rows, "b2")?.requester?.id).toBe(admin.id);
  expect(text).not.toContain(HASH);
});
