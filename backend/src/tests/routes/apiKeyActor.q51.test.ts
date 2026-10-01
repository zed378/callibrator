/**
 * Q-51 — an API key as the ACTOR of a data row: `api_key_id` names it, and
 * the column that references `users` is NULL.
 *
 * Before: the services wrote the principal's id — for a key, the KEY's id —
 * into `stock_adjustments.adjusted_by`, `stock_transfers.requested_by` and
 * `calibration_records.performed_by`, all foreign keys to `users`, so on
 * PostgreSQL the insert failed and the write rolled back. memoryDb enforces
 * no foreign key, so this suite asserts the shape that satisfies it (and the
 * CHECK of migration 0105: exactly one of the two set); the live suite
 * `tests/migrations/apiKeyActor.q51.live.test.ts` proves it on PostgreSQL 18.
 *
 * Also: the actor never comes from the body; and the three writes whose
 * actor column stays user-only (a void's voided_by, a transfer's approved_by,
 * an opname's performed_by) refuse a key with 403 and write nothing.
 *
 * REAL routers, gates, validators, controllers, services, audit service and
 * models (fixtures/memoryDb); every role holds every menu (grantAllMenus).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TenantRow, TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";
import type * as StockRoutes from "../../routes/api/stock.route";
import type * as RecordRoutes from "../../routes/api/calibrationRecords.route";

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
const records = jest.requireActual<typeof RecordRoutes>("../../routes/api/calibrationRecords.route");

const KEY_ID = "ab000000-0000-4000-8000-0000000000c1";
const FORGED_ID = "ab000000-0000-4000-8000-0000000000c2";
const WAREHOUSE_A = "a5100000-0000-4000-8000-000000000001";
const WAREHOUSE_B = "a5100000-0000-4000-8000-000000000002";
const STOCK_A = "a5100000-0000-4000-8000-000000000003";
const DEVICE_A = "a5100000-0000-4000-8000-000000000004";
const RECORD_BY_USER = "a5100000-0000-4000-8000-000000000005";
const RECORD_BY_KEY = "a5100000-0000-4000-8000-000000000006";
const TRANSFER_A = "a5100000-0000-4000-8000-000000000007";

const apiKey = (tenant: TenantRow, scopes: string[]): Principal => ({
  id: KEY_ID,
  username: "integration",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: scopes,
});

let fx: TwoTenantWorld;
let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  const tenantId = fx.tenantA.id;
  mdb.seed("Warehouse", [
    { id: WAREHOUSE_A, tenantId, name: "Main store", code: "WH-Q51-A", status: "active" },
    { id: WAREHOUSE_B, tenantId, name: "Ward store", code: "WH-Q51-B", status: "active" },
  ]);
  mdb.seed("Stock", { id: STOCK_A, tenantId, warehouseId: WAREHOUSE_A, itemName: "Fuse 5A", quantity: 10 });
  mdb.seed("StockTransfer", {
    id: TRANSFER_A,
    tenantId,
    fromWarehouseId: WAREHOUSE_A,
    toWarehouseId: WAREHOUSE_B,
    itemName: "Fuse 5A",
    quantity: 1,
    status: "pending",
    requestedBy: admin.id,
  });
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId, name: "Infusion pump", serialNumber: "SN-Q51" });
  mdb.seed("CalibrationRecord", [
    { id: RECORD_BY_USER, tenantId, deviceId: DEVICE_A, performedBy: admin.id, apiKeyId: null, calibrationDate: new Date("2026-09-01") },
    { id: RECORD_BY_KEY, tenantId, deviceId: DEVICE_A, performedBy: null, apiKeyId: KEY_ID, calibrationDate: new Date("2026-09-02") },
  ]);
});

/** The one row of `model` this request committed. */
const createdRow = (model: string, before: Row[]): Row => {
  const known = new Set(before.map((r) => r["id"]));
  const fresh = mdb.rows(model).filter((r) => !known.has(r["id"]));
  expect(fresh).toHaveLength(1);
  return fresh[0] ?? {};
};

const byKey = { apiKeyId: KEY_ID };

describe("Q-51 — an API key's stock writes name the key, not a user", () => {
  const key = (): Principal => apiKey(fx.tenantA, ["warehouse:write"]);

  it("POST /adjustment: adjustedBy is null and apiKeyId is the key", async () => {
    const before = mdb.rows("StockAdjustment");
    as(key());
    const res = await call(stock, "POST", "/adjustment", {
      body: { stockId: STOCK_A, type: "addition", quantity: 2, reason: "Delivery counted in" },
    });
    expect(res.status).toBe(201);
    expect(createdRow("StockAdjustment", before)).toMatchObject({ adjustedBy: null, ...byKey });
    expect(mdb.rows("AuditLog").at(-1)).toMatchObject({ userId: null, actorName: "system:api-key" });
  });

  it("POST / with an opening quantity: the opening adjustment names the key", async () => {
    const before = mdb.rows("StockAdjustment");
    as(key());
    const res = await call(stock, "POST", "/", {
      body: { warehouseId: WAREHOUSE_A, itemName: "Fuse 10A", quantity: 4 },
    });
    expect(res.status).toBe(201);
    expect(createdRow("StockAdjustment", before)).toMatchObject({ adjustedBy: null, ...byKey, quantityAfter: 4 });
  });

  it("POST /transfer: requestedBy is null and apiKeyId is the requesting key", async () => {
    const before = mdb.rows("StockTransfer");
    as(key());
    const res = await call(stock, "POST", "/transfer", {
      body: { fromWarehouseId: WAREHOUSE_A, toWarehouseId: WAREHOUSE_B, itemName: "Fuse 5A", quantity: 1 },
    });
    expect(res.status).toBe(201);
    expect(createdRow("StockTransfer", before)).toMatchObject({ requestedBy: null, ...byKey });
  });

  it("a user's adjustment is unchanged: adjustedBy is the user, apiKeyId null (positive control)", async () => {
    const before = mdb.rows("StockAdjustment");
    as(admin);
    const res = await call(stock, "POST", "/adjustment", {
      body: { stockId: STOCK_A, type: "subtraction", quantity: 1, reason: "Broken on the shelf" },
    });
    expect(res.status).toBe(201);
    expect(createdRow("StockAdjustment", before)).toMatchObject({ adjustedBy: admin.id, apiKeyId: null });
  });

  it("a body-supplied adjustedBy / apiKeyId is ignored — the actor is the principal", async () => {
    const before = mdb.rows("StockAdjustment");
    as(admin);
    const res = await call(stock, "POST", "/adjustment", {
      body: {
        stockId: STOCK_A, type: "addition", quantity: 1, reason: "Found in the back",
        adjustedBy: FORGED_ID, apiKeyId: FORGED_ID,
      },
    });
    expect(res.status).toBe(201);
    expect(createdRow("StockAdjustment", before)).toMatchObject({ adjustedBy: admin.id, apiKeyId: null });
  });

  it("a key's body naming a user is ignored too: the row names the key alone", async () => {
    const before = mdb.rows("StockTransfer");
    as(key());
    const res = await call(stock, "POST", "/transfer", {
      body: {
        fromWarehouseId: WAREHOUSE_A, toWarehouseId: WAREHOUSE_B, itemName: "Fuse 5A", quantity: 1,
        requestedBy: admin.id, apiKeyId: FORGED_ID,
      },
    });
    expect(res.status).toBe(201);
    expect(createdRow("StockTransfer", before)).toMatchObject({ requestedBy: null, ...byKey });
  });

  it("PATCH /transfer/:id (approve / complete / cancel) refuses a key with 403 and writes nothing", async () => {
    as(key());
    const res = await call(stock, "PATCH", `/transfer/${TRANSFER_A}`, { body: { status: "cancelled" } });
    expect(res.status).toBe(403);
    expect(mdb.writes()).toEqual([]);
  });

  it("POST /opname refuses a key with 403 and writes nothing", async () => {
    as(key());
    const res = await call(stock, "POST", "/opname", {
      body: { warehouseId: WAREHOUSE_A, scheduledAt: "2026-10-01T08:00:00.000Z" },
    });
    expect(res.status).toBe(403);
    expect(mdb.writes()).toEqual([]);
  });
});

describe("Q-51 — an API key's calibration records name the key, not a user", () => {
  const key = (): Principal => apiKey(fx.tenantA, ["calibration:write"]);

  it("POST /: performedBy is null and apiKeyId is the key", async () => {
    const before = mdb.rows("CalibrationRecord");
    as(key());
    const res = await call(records, "POST", "/", {
      body: { deviceId: DEVICE_A, calibrationDate: "2026-09-20", isCompliant: true },
    });
    expect(res.status).toBe(201);
    expect(createdRow("CalibrationRecord", before)).toMatchObject({ performedBy: null, ...byKey });
  });

  it("POST /: a body performedBy / apiKeyId is ignored for a user", async () => {
    const before = mdb.rows("CalibrationRecord");
    as(admin);
    const res = await call(records, "POST", "/", {
      body: { deviceId: DEVICE_A, calibrationDate: "2026-09-21", performedBy: FORGED_ID, apiKeyId: FORGED_ID },
    });
    expect(res.status).toBe(201);
    expect(createdRow("CalibrationRecord", before)).toMatchObject({ performedBy: admin.id, apiKeyId: null });
  });

  it("a correction keeps the ORIGINAL's actor: a key-recorded original stays key-recorded", async () => {
    const before = mdb.rows("CalibrationRecord");
    as(admin);
    const res = await call(records, "POST", `/${RECORD_BY_KEY}/corrections`, {
      body: { reason: "Transcription error in the results", notes: "Corrected" },
    });
    expect(res.status).toBe(201);
    expect(createdRow("CalibrationRecord", before)).toMatchObject({
      performedBy: null, ...byKey, supersedesId: RECORD_BY_KEY,
    });
  });

  it("a key's correction of a user's record keeps the user as performer, apiKeyId null", async () => {
    const before = mdb.rows("CalibrationRecord");
    as(key());
    const res = await call(records, "POST", `/${RECORD_BY_USER}/corrections`, {
      body: { reason: "Transcription error in the results", notes: "Corrected" },
    });
    expect(res.status).toBe(201);
    expect(createdRow("CalibrationRecord", before)).toMatchObject({
      performedBy: admin.id, apiKeyId: null, supersedesId: RECORD_BY_USER,
    });
  });

  it("POST /:id/void refuses a key with 403 and writes nothing (voided_by stays user-only)", async () => {
    as(key());
    const res = await call(records, "POST", `/${RECORD_BY_USER}/void`, {
      body: { reason: "Entered against the wrong device" },
    });
    expect(res.status).toBe(403);
    expect(mdb.writes()).toEqual([]);
  });
});
