/**
 * A-321 — DELETE /stocks/:stockId soft-deletes inside its transaction and
 * commits one audit row with it.
 *
 * `deleteStock` opened a transaction, read and checked the row in it, then
 * called `stock.softDelete()`, which saves WITHOUT the transaction (an
 * unmanaged transaction is not on CLS): the delete committed on its own
 * whatever happened next, and no audit row recorded it. The same shape was
 * fixed in `deleteWarehouse` by P6-11; this is the stock half.
 *
 * REAL router, controller, service, audit service and models on memoryDb,
 * whose transactions undo their writes on rollback.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type AuditService from "../../services/audit.service";
import type * as StockRoute from "../../routes/api/stock.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const auditService = jest.requireActual<typeof AuditService>("../../services/audit.service");
const router = jest.requireActual<typeof StockRoute>("../../routes/api/stock.route");

const WAREHOUSE = "a1000000-0000-4000-8000-000000000321";
const STOCK = "a2000000-0000-4000-8000-000000000321";
let admin: Principal;
let tenantId: string;

const stockRow = (): Record<string, unknown> | undefined => mdb.rows("Stock").find((r) => r["id"] === STOCK);

beforeEach(() => {
  mdb.reset();
  jest.restoreAllMocks();
  grantAllMenus();
  const fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  tenantId = fx.tenantA.id;
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Warehouse", { id: WAREHOUSE, tenantId, name: "Main", code: "WH-1" });
  mdb.seed("Stock", { id: STOCK, tenantId, warehouseId: WAREHOUSE, itemName: "Fuse 5A", sku: "F5", quantity: 4 });
  as(admin);
});

describe("A-321 — deleteStock is one transaction with its audit row", () => {
  it("commits the soft-delete and ONE audit row in the same transaction", async () => {
    const res = await call(router, "DELETE", `/${STOCK}`);
    expect(res.status).toBe(200);
    expect(stockRow()?.["isDeleted"]).toBe(true);

    const committed = mdb.committed();
    const stockWrites = committed.filter((w) => w.model === "Stock");
    const audits = committed.filter((w) => w.model === "AuditLog");
    expect(stockWrites).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(stockWrites[0]?.tx).not.toBeNull();
    expect(audits[0]?.tx).toBe(stockWrites[0]?.tx);

    expect(mdb.rows("AuditLog")).toEqual([
      expect.objectContaining({
        tenantId,
        userId: admin.id,
        action: "DELETE",
        resourceType: "Stock",
        resourceId: STOCK,
      }),
    ]);
  });

  it("a failed audit row rolls the soft-delete back", async () => {
    const real = auditService.logAction.bind(auditService);
    jest.spyOn(auditService, "logAction").mockImplementation(async (entry, options) => {
      await real(entry, options);
      throw new Error("forced rollback after the audit row was written");
    });

    const res = await call(router, "DELETE", `/${STOCK}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(stockRow()?.["isDeleted"]).toBe(false);
    const committed = mdb.committed();
    expect(committed.filter((w) => w.model === "Stock")).toEqual([]);
    expect(committed.filter((w) => w.model === "AuditLog")).toEqual([]);
  });

  it("control: a missing item is 404 and writes nothing", async () => {
    const res = await call(router, "DELETE", "/a2000000-0000-4000-8000-000000000999");
    expect(res.status).toBe(404);
    expect(mdb.writes()).toEqual([]);
  });
});
