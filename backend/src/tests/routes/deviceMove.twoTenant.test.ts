/**
 * P21-09d — moving a device between client facilities (spec P19-04 § 11.2; G-F2), through the REAL
 * router chain (auth double → tenant context and facility route gate, denyApiKey, validateUuid,
 * dynamicAccess, rbac, validate from params+body), the controller, services/deviceMove, the audit
 * service, the models and the tenant + facility hooks over memoryDb. `set_config` (raw SQL) is
 * answered by `onQuery`; the CASCADE of the facility to the children is the database's, proved by
 * `deviceMove.p2007.live` — here the children are counted, not moved.
 *
 * Two tenants: another tenant's device answers 404 exactly as a missing one, nothing written.
 * Two facilities: both routes are UNMARKED — a bound principal is refused 403
 * FACILITY_ROUTE_REFUSED, identically for its own device, another facility's and a missing id.
 *
 * @two-tenant api/calibrationDevices.route.ts POST /:calibrationDeviceId/move
 * @two-tenant api/calibrationDevices.route.ts GET /:calibrationDeviceId/moves
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/calibrationDevices.route";
import type * as MoveService from "../../services/deviceMove.service";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";

const mockEmits: { event: string; rooms: string[] }[] = [];
const mockRekey = { tenants: [] as string[] };

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/socket", () => ({
  getIo: () => ({ to: (rooms: string[]) => ({ emit: (event: string) => mockEmits.push({ event, rooms }) }) }),
}));
jest.mock("../../services/attachmentRekey.service", () => ({ enqueueRekey: (t: string) => mockRekey.tenants.push(t) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/calibrationDevices.route");
const { moveDevice } = jest.requireActual<typeof MoveService>("../../services/deviceMove.service");

const SELF_A = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const F_PAUSED = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const F_B = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";
const DEVICE = "d1000000-0000-4000-8000-000000000001";
const DEVICE_F2 = "d1000000-0000-4000-8000-000000000002";
const RETIRED = "d1000000-0000-4000-8000-000000000003";
const WITH_DRAFT = "d1000000-0000-4000-8000-000000000004";
const TWIN_F2 = "d1000000-0000-4000-8000-000000000005";
const ROOM_F1 = "a0000000-0000-4000-8000-000000000001";
const ROOM_F2 = "a0000000-0000-4000-8000-000000000002";
const STORE = "a0000000-0000-4000-8000-000000000003";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BOUND_USER = "cccccccc-0000-4000-8000-0000000000f1";
const ROUTE_FILE = "api/calibrationDevices.route.ts";
const BASE = "/api/v1/calibration-devices";
const REASON = "Handed over to Facility Two";

let ctx: SuiteContext;
let supervisor: Principal;
let boundAdmin: Principal;
let settings: string[] = [];
let seeded = 0;
const testWrites = (): string[] => mdb.committed().slice(seeded).map((w) => w.model);

interface Body { data?: unknown; message?: string; code?: string }
const bodyOf = (res: { body: unknown }): Body => res.body as Body;
const req = (principal: Principal | null, method: string, path: string, body: unknown = {}): ReturnType<typeof call> => {
  as(principal);
  return call(router, method, path, { body, baseUrl: BASE, routeFile: ROUTE_FILE });
};
const device = (id: string, tenantId: string, clientFacilityId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  tenantId,
  name: `Device ${id.slice(-2)}`,
  serialNumber: `SN-${id.slice(-2)}`,
  status: "active",
  clientFacilityId,
  isDeleted: false,
  ...extra,
});

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  mockEmits.length = 0;
  mockRekey.tenants.length = 0;
  settings = [];
  mdb.onQuery((sql, options) => {
    if (sql.includes("set_config")) {
      settings.push(String((options as { bind?: unknown[] }).bind?.join("=")));
      return [{ set_config: "ok" }];
    }
    throw new Error(`unexpected raw SQL: ${sql}`);
  });
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  supervisor = fx.principal(fx.tenantA, "SUPERVISOR");
  boundAdmin = { ...fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), id: BOUND_USER, clientFacilityId: F1 } as unknown as Principal;
  seedTenants(mdb, fx, [ctx.owner, ctx.other, supervisor]);
  const A = fx.tenantA.id;
  mdb.seed("ClientFacility", [
    { id: SELF_A, tenantId: A, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: A, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: A, name: "Facility Two", code: "F-0002", status: "active" },
    { id: F_PAUSED, tenantId: A, name: "Facility Paused", code: "F-0003", status: "inactive", statusReason: "paused" },
    { id: F_B, tenantId: fx.tenantB.id, name: "Other's", code: "F-0009", status: "active" },
  ]);
  mdb.seed("Warehouse", [
    { id: ROOM_F1, tenantId: A, name: "Room One", code: "R-1", clientFacilityId: F1, status: "active", isDeleted: false },
    { id: ROOM_F2, tenantId: A, name: "Room Two", code: "R-2", clientFacilityId: F2, status: "active", isDeleted: false },
    { id: STORE, tenantId: A, name: "Store", code: "S-1", clientFacilityId: null, status: "active", isDeleted: false },
  ]);
  mdb.seed("CalibrationDevice", [
    device(DEVICE, A, F1, { locationId: ROOM_F1 }),
    device(DEVICE_F2, fx.tenantB.id, F_B),
    device(RETIRED, A, F1, { status: "retired" }),
    device(WITH_DRAFT, A, F1),
    device(TWIN_F2, A, F2, { serialNumber: "SN-TWIN" }),
  ]);
  mdb.seed("Certificate", [
    { id: "c0000000-0000-4000-8000-000000000001", tenantId: A, deviceId: DEVICE, clientFacilityId: F1, certificateNumber: "CERT-0001", status: "signed" },
    { id: "c0000000-0000-4000-8000-000000000002", tenantId: A, deviceId: WITH_DRAFT, clientFacilityId: F1, certificateNumber: "CERT-0002", status: "draft" },
  ]);
  mdb.seed("Attachment", [
    { id: "a1000000-0000-4000-8000-000000000001", tenantId: A, resourceType: "device", resourceId: DEVICE, clientFacilityId: F1, fileName: "p.jpg", originalName: "p.jpg", folder: "uploads/attachments", storageKey: `t/${A}/f/${F1}/attachments/p.jpg`, size: 1, uploadedBy: ctx.owner.id },
    { id: "a1000000-0000-4000-8000-000000000002", tenantId: A, resourceType: "certificate", resourceId: "c0000000-0000-4000-8000-000000000001", clientFacilityId: F1, fileName: "c.pdf", originalName: "c.pdf", folder: "uploads/attachments", storageKey: `t/${A}/attachments/c.pdf`, size: 1, uploadedBy: ctx.owner.id },
  ]);
  seeded = mdb.committed().length;
});

twoTenantSuite({
  module: "calibration-devices (move)",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "POST /:calibrationDeviceId/move",
      method: "POST",
      path: (id) => `/${id}/move`,
      id: () => DEVICE,
      body: { targetClientFacilityId: F2, reason: REASON },
      writes: ["ClientFacilityMove", "CalibrationDevice", "Attachment", "AuditLog"],
    },
    { key: "GET /:calibrationDeviceId/moves", method: "GET", path: (id) => `/${id}/moves`, id: () => DEVICE },
  ],
});

describe("two facilities — the move routes are unmarked (403 FACILITY_ROUTE_REFUSED for a bound principal)", () => {
  it.each([
    ["POST /move", "POST", (id: string) => `/${id}/move`, { targetClientFacilityId: F2, reason: REASON }],
    ["GET /moves", "GET", (id: string) => `/${id}/moves`, {}],
  ] as const)("%s: identical for its own facility's device, another facility's and a missing id; nothing written", async (_k, method, path, body) => {
    const own = await req(boundAdmin, method, path(DEVICE), body);
    const otherFacility = await req(boundAdmin, method, path(TWIN_F2), body);
    const missing = await req(boundAdmin, method, path(MISSING), body);
    for (const res of [own, otherFacility, missing]) {
      expect(res.status).toBe(403);
      expect(bodyOf(res).code).toBe("FACILITY_ROUTE_REFUSED");
    }
    expect(own.body).toEqual(missing.body);
    expect(testWrites()).toEqual([]);
  });
});

describe("P19-04 § 11.2 — the move", () => {
  it("moves the device, clears the old facility's room, follows the files, completes the move, two audit rows; then emits and re-keys", async () => {
    const res = await req(ctx.owner, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, reason: REASON });
    expect(res.status).toBe(200);
    const data = bodyOf(res).data as { moveId: string; fromClientFacilityId: string; toClientFacilityId: string; locationId: string | null; counts: Record<string, number> };
    expect(data).toMatchObject({ fromClientFacilityId: F1, toClientFacilityId: F2, locationId: null });
    expect(data.counts).toMatchObject({ certificates: 1, attachments_rekey: 2 });
    expect(settings).toEqual([`callibrator.facility_move=${data.moveId}`]);
    expect(mdb.rows("CalibrationDevice").find((d) => d["id"] === DEVICE)).toMatchObject({ clientFacilityId: F2, locationId: null });
    expect(mdb.rows("Attachment").map((a) => [a["clientFacilityId"], a["rekeyPending"]])).toEqual([[F2, true], [F2, true]]);
    expect(mdb.rows("ClientFacilityMove")).toEqual([
      expect.objectContaining({ id: data.moveId, deviceId: DEVICE, fromClientFacilityId: F1, toClientFacilityId: F2, status: "completed", reason: REASON }),
    ]);
    const audits = mdb.rows("AuditLog").map((a) => [a["clientFacilityId"], (a["changes"] as { operation: string }).operation]);
    expect(audits).toEqual([[F1, "MOVE_DEVICE_OUT"], [F2, "MOVE_DEVICE_IN"]]);
    expect(mockRekey.tenants).toEqual([ctx.owner.tenantId]);
    expect(mockEmits).toEqual([
      { event: "device:moved_out", rooms: [`tenant_${ctx.owner.tenantId}`, `facility_${ctx.owner.tenantId}_${F1}`] },
      { event: "device:moved_in", rooms: [`tenant_${ctx.owner.tenantId}`, `facility_${ctx.owner.tenantId}_${F2}`] },
    ]);
  });

  it("a target room of the new facility is taken; a provider store is kept", async () => {
    expect((await req(ctx.owner, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, targetLocationId: ROOM_F2, reason: REASON })).status).toBe(200);
    expect(mdb.rows("CalibrationDevice").find((d) => d["id"] === DEVICE)?.["locationId"]).toBe(ROOM_F2);
  });

  it("targetLocationId null clears any location; without one a provider store is kept", async () => {
    expect((await req(ctx.owner, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, targetLocationId: null, reason: REASON })).status).toBe(200);
    expect(mdb.rows("CalibrationDevice").find((d) => d["id"] === DEVICE)?.["locationId"]).toBeNull();
    mdb.seed("CalibrationDevice", device("d1000000-0000-4000-8000-000000000007", ctx.owner.tenantId, F1, { locationId: STORE }));
    expect((await req(ctx.owner, "POST", "/d1000000-0000-4000-8000-000000000007/move", { targetClientFacilityId: F2, reason: REASON })).status).toBe(200);
    expect(mdb.rows("CalibrationDevice").find((d) => d["id"] === "d1000000-0000-4000-8000-000000000007")?.["locationId"]).toBe(STORE);
  });

  it("a device with no serial and no location moves; a never-moved device has no moves", async () => {
    mdb.seed("CalibrationDevice", device("d1000000-0000-4000-8000-000000000008", ctx.owner.tenantId, F1, { serialNumber: null }));
    expect((await req(ctx.owner, "POST", "/d1000000-0000-4000-8000-000000000008/move", { targetClientFacilityId: F2, reason: REASON })).status).toBe(200);
    const none = await req(supervisor, "GET", `/${TWIN_F2}/moves`);
    expect([none.status, bodyOf(none).data]).toEqual([200, []]);
  });

  it("the service refuses a bound actor itself (defence in depth: the route is unmarked)", async () => {
    await expect(
      tenantStorage.run(
        { tenantId: ctx.owner.tenantId as TenantId, isSuperAdmin: false, isSystemTask: false, userId: BOUND_USER, clientFacilityId: F1 as ClientFacilityId, facilityBound: true },
        () => moveDevice(ctx.owner.tenantId as TenantId, { calibrationDeviceId: DEVICE, targetClientFacilityId: F2, reason: REASON }, { userId: BOUND_USER }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("the moves list: newest first, with the facilities' names", async () => {
    await req(ctx.owner, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, reason: REASON });
    const res = await req(supervisor, "GET", `/${DEVICE}/moves`);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual([
      expect.objectContaining({ from: { id: F1, name: "Facility One" }, to: { id: F2, name: "Facility Two" }, reason: REASON }),
    ]);
  });

  it.each([
    ["the same facility", DEVICE, { targetClientFacilityId: F1 }, 409, "The device is already in this facility."],
    ["a target not active", DEVICE, { targetClientFacilityId: F_PAUSED }, 409, "A device cannot be moved into a facility that is inactive."],
    ["a retired device", RETIRED, { targetClientFacilityId: F2 }, 409, "A retired device stays in the facility that retired it; reinstate it first."],
    ["a certificate not yet signed", WITH_DRAFT, { targetClientFacilityId: F2 }, 409, "Certificate CERT-0002 is draft; issue or void it first — its customer is the facility the calibration was done for."],
    ["a room of another facility", DEVICE, { targetClientFacilityId: F2, targetLocationId: ROOM_F1 }, 409, "The location Room One belongs to another facility; choose a room of the target facility or a provider store."],
    ["another tenant's facility", DEVICE, { targetClientFacilityId: F_B }, 404, "Client facility not found"],
    ["a missing location", DEVICE, { targetClientFacilityId: F2, targetLocationId: MISSING }, 404, "Location not found"],
  ] as const)("%s → %i with its explanation; nothing written", async (_label, id, body, status, message) => {
    const res = await req(ctx.owner, "POST", `/${id}/move`, { ...body, reason: REASON });
    expect({ status: res.status, message: bodyOf(res).message }).toEqual({ status, message });
    expect(testWrites()).toEqual([]);
  });

  it("the serial already used in the target → 409 naming it", async () => {
    mdb.seed("CalibrationDevice", device("d1000000-0000-4000-8000-000000000006", ctx.owner.tenantId, F1, { serialNumber: "SN-TWIN" }));
    seeded = mdb.committed().length;
    const res = await req(ctx.owner, "POST", "/d1000000-0000-4000-8000-000000000006/move", { targetClientFacilityId: F2, reason: REASON });
    expect({ status: res.status, message: bodyOf(res).message }).toEqual({ status: 409, message: "A device with this serial number already exists in Facility Two." });
    expect(testWrites()).toEqual([]);
  });

  it("gates: a SUPERVISOR is refused (rbac), an API key is refused, a strict body refuses extra fields", async () => {
    expect((await req(supervisor, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, reason: REASON })).status).toBe(403);
    expect((await req({ ...ctx.owner, isApiKey: true }, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, reason: REASON })).status).toBe(403);
    expect((await req(ctx.owner, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, reason: REASON, tenantId: ctx.other.tenantId })).status).toBe(400);
    expect(testWrites()).toEqual([]);
  });

  it("a failure after the move row rolls back everything: no move, no audit, the device where it was", async () => {
    mdb.onQuery(() => {
      throw new Error("set_config failed");
    });
    const res = await req(ctx.owner, "POST", `/${DEVICE}/move`, { targetClientFacilityId: F2, reason: REASON });
    expect(res.status).toBe(500);
    expect(mdb.rows("ClientFacilityMove")).toEqual([]);
    expect(mdb.rows("AuditLog")).toEqual([]);
    expect(mdb.rows("CalibrationDevice").find((d) => d["id"] === DEVICE)?.["clientFacilityId"]).toBe(F1);
    expect(mockEmits).toEqual([]);
  });
});
