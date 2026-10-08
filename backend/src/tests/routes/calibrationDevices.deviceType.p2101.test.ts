/**
 * P21-01 — giving a device its type (spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.7;
 * ADR-125 Am. 2 "the 400 on giving a device a retired type").
 *
 * REAL: calibrationDevices.route with its gates, the controller, the service, the catalogue's
 * device-type check, the audit service, the models and the tenant hooks over memoryDb.
 *
 * A device may not be GIVEN a type that is retired or does not exist (400 with the reason); a
 * device that already holds a retired type keeps it through an edit; a type may be cleared.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/calibrationDevices.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/calibrationDevices.route");

const SELF = "50505050-5050-4050-8050-5050505050d1";
const ACTIVE_TYPE = "a1a1a1a1-0000-4000-8000-000000000001";
const RETIRED_TYPE = "a1a1a1a1-0000-4000-8000-000000000003";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const HOLDS_RETIRED = "a1000000-0000-4000-8000-0000000000e1";

let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("ClientFacility", { id: SELF, tenantId: fx.tenantA.id, name: "Self", code: "SELF", isSelf: true, status: "active" });
  mdb.seed("DeviceType", [
    { id: ACTIVE_TYPE, name: "Test Device Type A", status: "active" },
    { id: RETIRED_TYPE, name: "Test Device Type Retired", status: "retired" },
  ]);
  mdb.seed("CalibrationDevice", {
    id: HOLDS_RETIRED,
    tenantId: fx.tenantA.id,
    clientFacilityId: SELF,
    name: "Synthetic pump",
    serialNumber: "SN-P2101-1",
    status: "active",
    deviceTypeId: RETIRED_TYPE,
  });
});

const send = async (method: string, path: string, body: unknown): Promise<{ status: number; body: { message?: string; data?: Record<string, unknown> } }> => {
  as(admin);
  return (await call(router, method, path, { body })) as unknown as { status: number; body: { message?: string; data?: Record<string, unknown> } };
};

describe("a device's type (spec § 4.7)", () => {
  it("create: an active type is given; a retired or unknown one is a 400 with the reason", async () => {
    const ok = await send("POST", "/", { name: "Typed pump", serialNumber: "SN-P2101-2", deviceTypeId: ACTIVE_TYPE });
    expect(ok.status).toBe(201);
    expect(ok.body.data?.["deviceTypeId"]).toBe(ACTIVE_TYPE);
    const retired = await send("POST", "/", { name: "Typed pump", serialNumber: "SN-P2101-3", deviceTypeId: RETIRED_TYPE });
    expect({ status: retired.status, message: retired.body.message }).toEqual({ status: 400, message: "This device type is retired; choose its replacement." });
    const unknown = await send("POST", "/", { name: "Typed pump", serialNumber: "SN-P2101-4", deviceTypeId: MISSING });
    expect({ status: unknown.status, message: unknown.body.message }).toEqual({ status: 400, message: "Unknown device type." });
  });

  it("edit: a device keeps the retired type it holds; changing to a retired type is refused; clearing is allowed", async () => {
    expect((await send("PUT", `/${HOLDS_RETIRED}`, { name: "Renamed pump", deviceTypeId: RETIRED_TYPE })).status).toBe(200);
    expect((await send("PUT", `/${HOLDS_RETIRED}`, { deviceTypeId: ACTIVE_TYPE })).status).toBe(200);
    expect((await send("PUT", `/${HOLDS_RETIRED}`, { deviceTypeId: RETIRED_TYPE })).status).toBe(400);
    const cleared = await send("PUT", `/${HOLDS_RETIRED}`, { deviceTypeId: null });
    expect(cleared.status).toBe(200);
    expect(mdb.rows("CalibrationDevice")[0]?.["deviceTypeId"] ?? null).toBeNull();
  });
});
