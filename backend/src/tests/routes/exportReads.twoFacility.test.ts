/**
 * P21-06 — G-22 (docs/SECURITY/15 § 11; spec P19-04 § 19): every export page read holds F1's rows
 * only for a bound F1 reader — the inventory (the device list, with its photo ids for the
 * thumbnails) and the calibration recap (the record list). A `clientFacilityId` filter naming F2
 * from F1 reads NOTHING: it used to be REPLACED by the facility hook's own predicate on the device
 * list, so the bound reader got its own devices back instead of an empty page (fixed here, under
 * `Op.and`). Provider staff read F2 through the same filter.
 *
 * REAL: the routers' chains, controllers, services, models and the tenant + facility hooks over
 * memoryDb. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");
const records = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");

const PHOTO_F1 = "a7000000-0000-4000-8000-0000000216f1";
const PHOTO_F2 = "a7000000-0000-4000-8000-0000000216f2";
const REC_F1 = "c0000000-0000-4000-8000-0000000216f1";
const REC_F2 = "c0000000-0000-4000-8000-0000000216f2";

interface Res { status: number; body: { data?: Record<string, unknown>[] } }
let world: IpmWorld;

const read = (router: unknown, file: string, base: string, who: Principal, query: Record<string, unknown> = {}): Promise<Res> => {
  as(who);
  return call(router, "GET", "/", { query, routeFile: file, baseUrl: base }) as Promise<Res>;
};
const inventory = (who: Principal, query: Record<string, unknown> = {}): Promise<Res> =>
  read(devices, "api/calibrationDevices.route.ts", "/api/v1/calibration-devices", who, query);
const recap = (who: Principal, query: Record<string, unknown> = {}): Promise<Res> =>
  read(records, "api/calibrationRecords.route.ts", "/api/v1/calibration-records", who, query);
const ids = (res: Res): unknown[] => (res.body.data ?? []).map((r) => r["id"]).sort();

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  const photo = (id: string, device: string, facility: string): Record<string, unknown> => ({
    id, tenantId: world.tenantA, clientFacilityId: facility, resourceType: "device", resourceId: device, purpose: "device_front",
    fileName: `${id}.jpg`, originalName: "device_front.jpg", folder: "uploads/attachments", mimeType: "image/jpeg", size: 3, uploadedBy: null,
  });
  mdb.seed("Attachment", [photo(PHOTO_F1, IPM.D1, IPM.F1), photo(PHOTO_F2, IPM.D2, IPM.F2)]);
  const record = (id: string, device: string, facility: string): Record<string, unknown> => ({
    id, tenantId: world.tenantA, deviceId: device, clientFacilityId: facility, performedBy: world.staff.id, calibrationDate: new Date("2026-09-01T00:00:00Z"), isDeleted: false,
  });
  mdb.seed("CalibrationRecord", [record(REC_F1, IPM.D1, IPM.F1), record(REC_F2, IPM.D2, IPM.F2)]);
});

describe("G-22 — the export page reads hold F1's rows only for a bound F1 reader", () => {
  it("the inventory: F1's devices with F1's photo id; F2 named → an empty page", async () => {
    const own = await inventory(world.bound);
    const foreign = await inventory(world.bound, { clientFacilityId: IPM.F2 });
    expect(ids(own)).toEqual([IPM.D1]);
    expect(own.body.data?.[0]).toMatchObject({ frontPhotoAttachmentId: PHOTO_F1 });
    expect(JSON.stringify(own.body)).not.toContain(PHOTO_F2);
    expect([foreign.status, ids(foreign)]).toEqual([200, []]);
  });

  it("the calibration recap: F1's records; F2 named → an empty page (latest-per-device included)", async () => {
    mdb.onQuery(() => []);
    const own = await recap(world.bound);
    const foreign = await recap(world.bound, { clientFacilityId: IPM.F2 });
    const latest = await recap(world.bound, { clientFacilityId: IPM.F2, latestOnly: "true" });
    expect([ids(own), ids(foreign), ids(latest)]).toEqual([[REC_F1], [], []]);
  });

  it("provider staff read F2 through the same filter (FT-39)", async () => {
    expect([ids(await inventory(world.staff, { clientFacilityId: IPM.F2 })), ids(await recap(world.staff, { clientFacilityId: IPM.F2 }))]).toEqual([[IPM.D2], [REC_F2]]);
  });
});
