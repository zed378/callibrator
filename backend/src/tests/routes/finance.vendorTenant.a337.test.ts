/**
 * A-337 (2026-10-01) — an asset finance record names only a vendor of the
 * caller's tenant.
 *
 * `POST /api/v1/finance` checked the device's tenant and not the vendor's,
 * and `PATCH /:financeId` checked neither: any vendor id the foreign key
 * accepted was stored, including another tenant's. Fail-before: against
 * `finance.service` without the check, both writes stored the other tenant's
 * vendor (201 / 200).
 *
 * Another tenant's vendor answers exactly what a vendor that does not exist
 * answers: 404, same message — never 403. An absent or null `vendorId` names
 * no vendor and is accepted.
 *
 * @two-tenant api/finance.route.ts PATCH /:financeId
 *
 * REAL router, dynamicAccess (matrix granted), validate, controller, service,
 * audit, models and tenant hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as FinanceRoute from "../../routes/api/finance.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof FinanceRoute>("../../routes/api/finance.route");

const VENDOR_A = "a3370000-0000-4000-8000-00000000000a";
const VENDOR_B = "a3370000-0000-4000-8000-00000000000b";
const MISSING = "a3370000-0000-4000-8000-0000000000ee";
const DEVICE_WITH_RECORD = "a3370000-0000-4000-8000-0000000000d1";
const DEVICE_FREE = "a3370000-0000-4000-8000-0000000000d2";
const RECORD = "a3370000-0000-4000-8000-000000000001";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: fx.tenantA.id, name: "Lab A", type: "CalibrationLab", status: "Active" });
  mdb.seed("Vendor", { id: VENDOR_B, tenantId: fx.tenantB.id, name: "Lab B", type: "CalibrationLab", status: "Active" });
  mdb.seed("CalibrationDevice", { id: DEVICE_WITH_RECORD, tenantId: fx.tenantA.id, name: "Ventilator", serialNumber: "SN-1" });
  mdb.seed("CalibrationDevice", { id: DEVICE_FREE, tenantId: fx.tenantA.id, name: "Monitor", serialNumber: "SN-2" });
  mdb.seed("AssetFinance", {
    id: RECORD, tenantId: fx.tenantA.id, deviceId: DEVICE_WITH_RECORD, purchasePrice: "1000.00", purchaseDate: "2025-01-01",
    salvageValue: "0.00", usefulLifeYears: 5, depreciationMethod: "straight_line", vendorId: null,
  });
  as(admin);
});

type Row = Record<string, unknown>;
const records = (): Row[] => mdb.rows("AssetFinance");
const stored = (id: string): Row | undefined => records().find((row) => row["id"] === id);
const answer = (res: { status: number; body: unknown }) => ({ status: res.status, message: (res.body as { message?: unknown }).message });
const create = { deviceId: DEVICE_FREE, purchasePrice: 5000, purchaseDate: "2026-01-15", usefulLifeYears: 5 };

describe("A-337 — an asset finance record's vendor is the caller's tenant's", () => {
  it("PATCH to another tenant's vendor answers exactly what a missing vendor answers (404), and changes nothing", async () => {
    const before = JSON.stringify(stored(RECORD));
    const crossTenant = await call(router, "PATCH", `/${RECORD}`, { body: { vendorId: VENDOR_B } });
    const missing = await call(router, "PATCH", `/${RECORD}`, { body: { vendorId: MISSING } });
    expect(answer(crossTenant)).toEqual({ status: 404, message: "Vendor not found" });
    expect(answer(crossTenant)).toEqual(answer(missing));
    expect(JSON.stringify(stored(RECORD))).toBe(before);
  });

  it("POST naming another tenant's vendor is the same 404 as a missing one, and creates nothing", async () => {
    const crossTenant = await call(router, "POST", "/", { body: { ...create, vendorId: VENDOR_B } });
    const missing = await call(router, "POST", "/", { body: { ...create, vendorId: MISSING } });
    expect(answer(crossTenant)).toEqual({ status: 404, message: "Vendor not found" });
    expect(answer(crossTenant)).toEqual(answer(missing));
    expect(records()).toHaveLength(1);
  });

  it("the tenant's own vendor, null and an absent vendorId are accepted", async () => {
    expect((await call(router, "PATCH", `/${RECORD}`, { body: { vendorId: VENDOR_A } })).status).toBe(200);
    expect(stored(RECORD)?.["vendorId"]).toBe(VENDOR_A);
    expect((await call(router, "PATCH", `/${RECORD}`, { body: { vendorId: null } })).status).toBe(200);
    expect(stored(RECORD)?.["vendorId"]).toBeNull();
    expect((await call(router, "PATCH", `/${RECORD}`, { body: { notes: "Insured" } })).status).toBe(200);
    expect((await call(router, "POST", "/", { body: { ...create, vendorId: VENDOR_A } })).status).toBe(201);
  });
});
