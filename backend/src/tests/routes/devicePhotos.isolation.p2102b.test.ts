/**
 * P21-02b — the device photo routes' isolation (P18-04 A-13, C-10; spec P19-03 § 7.2, § 13):
 *  - two tenants: another tenant's device (upload) or photo (delete) answers 404, identical to a
 *    missing one, and NOTHING is written — no row, no audit row, no object in storage;
 *  - two facilities: a bound F1 technician gets the same 404 for F2's device or photo; F1's own
 *    are reached; provider staff reach both (FT-39).
 *
 * @two-tenant api/calibrationDevices.route.ts POST /:calibrationDeviceId/photos
 * @two-tenant api/calibrationDevices.route.ts DELETE /:calibrationDeviceId/photos/:attachmentId
 * @two-facility api/calibrationDevices.route.ts POST /:calibrationDeviceId/photos
 * @two-facility api/calibrationDevices.route.ts DELETE /:calibrationDeviceId/photos/:attachmentId
 *
 * REAL: the router chain, the controller, the service, the image pipeline, the models and the
 * tenant + facility hooks over memoryDb, the fake storage. DOUBLED: multer (a real temporary file),
 * the quota check, the quarantine guard, the virus scan. Synthetic data only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as TenantSuite from "../fixtures/twoTenantSuite";
import type * as FacilitySuite from "../fixtures/twoFacilitySuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { FacilitySuiteContext } from "../fixtures/twoFacilitySuite";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { jpeg } from "../fixtures/photoFixtures";

jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));
jest.mock("../../utils/upload.util", () => ({
  ...jest.requireActual<object>("../../utils/upload.util"),
  upload: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
  assertInQuarantine: (p: string) => p,
}));
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn(() => Promise.resolve({ clean: true })) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const storage = jest.requireMock<FakeStorageModule>("../../services/storage");
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof TenantSuite>("../fixtures/twoTenantSuite");
const { twoFacilitySuite } = jest.requireActual<typeof FacilitySuite>("../fixtures/twoFacilitySuite");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");

/** One live front photo of each device: F1's, F2's, tenant B's. */
const PHOTO = Object.freeze({
  D1: "a7000000-0000-4000-8000-0000000b02f1",
  D2: "a7000000-0000-4000-8000-0000000b02f2",
  DB: "a7000000-0000-4000-8000-0000000b02fb",
});
const BYTES = jpeg(24, 24);

let world: IpmWorld;
let tmp = "";
let tenantCtx: SuiteContext;
let facilityCtx: FacilitySuiteContext;

/** A fresh quarantined file for each request (the service reads it; the harness never removes it). */
const file = (): Record<string, unknown> => {
  const at = path.join(tmp, `photo-${String(Math.random()).slice(2)}.jpg`);
  fs.writeFileSync(at, BYTES);
  return { path: at, filename: path.basename(at), originalname: "photo.jpg", mimetype: "image/jpeg", size: BYTES.length };
};

/** Which device a photo belongs to (the delete's path names both). */
const deviceOf = (photoId: string): string =>
  photoId === PHOTO.D1 ? IPM.D1 : photoId === PHOTO.D2 ? IPM.D2 : photoId === PHOTO.DB ? IPM.DB : IPM.D1;

const photoRow = (id: string, tenantId: string, deviceId: string, facility: string): Record<string, unknown> => ({
  id,
  tenantId,
  clientFacilityId: facility,
  resourceType: "device",
  resourceId: deviceId,
  purpose: "device_front",
  storageKey: `t/${tenantId}/f/${facility}/attachments/${id}.jpg`,
  fileName: `${id}.jpg`,
  originalName: "device_front.jpg",
  folder: "uploads/attachments",
  mimeType: "image/jpeg",
  size: 3,
  checksum: "0".repeat(64),
  uploadedBy: null,
});

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2102b-iso-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  mdb.reset();
  storage.__reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("Attachment", [
    photoRow(PHOTO.D1, world.tenantA, IPM.D1, IPM.F1),
    photoRow(PHOTO.D2, world.tenantA, IPM.D2, IPM.F2),
    photoRow(PHOTO.DB, world.tenantB, IPM.DB, IPM.FB),
  ]);
  tenantCtx = { owner: world.staff, other: world.other };
  facilityCtx = { bound: world.bound, unbound: world.staff };
});

describe("nothing stored for a foreign device (spec § 7.2: \"nothing stored\")", () => {
  it("another tenant's and another facility's device: no object in storage, the file not even scanned", async () => {
    const { as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
    const scan = jest.requireMock<{ scanFile: jest.Mock }>("../../services/virusScan.service").scanFile;
    scan.mockClear();
    for (const [who, device] of [[world.staff, IPM.DB], [world.bound, IPM.D2]] as const) {
      as(who);
      const res = await call(devices, "POST", `/${device}/photos`, { body: { purpose: "device_front" }, file: file(), routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" });
      expect(res.status).toBe(404);
    }
    expect([[...storage.__objects.keys()], scan.mock.calls.length]).toEqual([[], 0]);
  });
});

twoTenantSuite({
  module: "device photos (P21-02b, A-13)",
  router: devices,
  mdb,
  context: () => tenantCtx,
  routes: [
    {
      key: "POST /:calibrationDeviceId/photos",
      method: "POST",
      path: (id) => `/${id}/photos`,
      id: () => IPM.DB,
      principal: () => world.staff,
      ownerPrincipal: () => world.other,
      body: { purpose: "device_front" },
      file,
      writes: ["Attachment", "AuditLog"],
      ownerStatus: 201,
    },
    {
      key: "DELETE /:calibrationDeviceId/photos/:attachmentId",
      method: "DELETE",
      path: (id) => `/${deviceOf(id)}/photos/${id}`,
      id: () => PHOTO.DB,
      principal: () => world.staff,
      ownerPrincipal: () => world.other,
      writes: ["Attachment", "AuditLog"],
      ownerStatus: 200,
    },
  ],
});

twoFacilitySuite({
  module: "device photos (P21-02b, C-10)",
  router: devices,
  routeFile: "api/calibrationDevices.route.ts",
  baseUrl: "/api/v1/calibration-devices",
  mdb,
  context: () => facilityCtx,
  routes: [
    {
      key: "POST /:calibrationDeviceId/photos",
      method: "POST",
      path: (id) => `/${id}/photos`,
      ownId: () => IPM.D1,
      foreignId: () => IPM.D2,
      body: { purpose: "device_other" },
      file,
      ownStatus: 201,
      writes: ["Attachment", "AuditLog"],
      unboundToo: true,
    },
    {
      key: "DELETE /:calibrationDeviceId/photos/:attachmentId",
      method: "DELETE",
      path: (id) => `/${deviceOf(id)}/photos/${id}`,
      ownId: () => PHOTO.D1,
      foreignId: () => PHOTO.D2,
      ownStatus: 200,
      writes: ["Attachment", "AuditLog"],
      unboundToo: true,
    },
  ],
});
