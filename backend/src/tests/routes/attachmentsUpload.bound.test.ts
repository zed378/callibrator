/**
 * P21-09e — G-P6 (P18-03 § 8.2 A-5, C-4): `POST /attachments` for a facility-BOUND principal.
 *
 * REAL: the router chain (auth double → tenant context + facility route gate, dynamicAccess with
 * the bound ceiling, the bound upload gate), the controller, attachment.service (the link check in
 * context, the checksum, the row and its audit row), the hooks over memoryDb, the fake storage.
 * DOUBLED: multer (the file is handed in as `req.file`, a real temporary file), the quota check,
 * the quarantine guard and the virus scan.
 *
 *  - a device photo of the bound principal's facility, with calibration write (HEALTHCARE
 *    TECHNICIAN, UD-4 (b)): stored under the facility's key segment, the row in F1;
 *  - another facility's device: 404, the same as a missing one; nothing stored;
 *  - a standalone file (`generic`, `ticket`, `post`), any other type, or no resourceId: 403
 *    `FACILITY_UPLOAD_REFUSED`, the quarantined file removed;
 *  - a bound ROOM USER (calibration read only): 403;
 *  - provider staff: unchanged (a generic upload still works).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type * as RouteModule from "../../routes/api/attachments.route";
import type { NextFunction, Request, Response } from "express";

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
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/attachments.route");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const D1 = "d1000000-0000-4000-8000-0000000000f1";
const D2 = "d1000000-0000-4000-8000-0000000000f2";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let tech: Principal;
let room: Principal;
let staff: Principal;
let tmp = "";
let tenant = "";

const upload = async (who: Principal, body: Record<string, unknown>): Promise<{ status: number; body: { code?: string; message?: string; data?: Record<string, unknown> } }> => {
  const file = path.join(tmp, `photo-${String(Math.random()).slice(2)}.jpg`);
  fs.writeFileSync(file, "jpeg-bytes");
  as(who);
  const res = await call(router, "POST", "/", {
    body,
    routeFile: "api/attachments.route.ts",
    file: { path: file, filename: path.basename(file), originalname: "photo.jpg", mimetype: "image/jpeg", size: 10 },
  });
  return res as { status: number; body: { code?: string; message?: string; data?: Record<string, unknown> } };
};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2109e-upload-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  mdb.reset();
  storage.__reset();
  grantAllMenus();
  const fx = twoTenants();
  tenant = fx.tenantA.id;
  staff = fx.principal(fx.tenantA, "TECHNICIAN");
  tech = { ...fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"), id: "cccccccc-0000-4000-8000-0000000000f1", clientFacilityId: F1 } as unknown as Principal;
  room = { ...fx.principal(fx.tenantA, "ROOM_USER"), id: "cccccccc-0000-4000-8000-0000000000f3", clientFacilityId: F1 } as unknown as Principal;
  seedTenants(mdb, fx, [staff]);
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: tenant, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: tenant, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
  mdb.seed("CalibrationDevice", [
    { id: D1, tenantId: tenant, clientFacilityId: F1, name: "Pump 1", status: "active", isDeleted: false },
    { id: D2, tenantId: tenant, clientFacilityId: F2, name: "Pump 2", status: "active", isDeleted: false },
  ]);
});

describe("G-P6 — a bound upload is a device photo of its facility", () => {
  it("own facility's device: 201, stored under F1's segment, the row in F1, audited", async () => {
    const res = await upload(tech, { resourceType: "device", resourceId: D1 });
    expect(res.status).toBe(201);
    const [row] = mdb.rows("Attachment");
    expect(row).toMatchObject({ resourceId: D1, clientFacilityId: F1, uploadedBy: tech.id });
    expect(String(row?.["storageKey"])).toMatch(new RegExp(`^t/${tenant}/f/${F1}/attachments/`));
    expect(mdb.rows("AuditLog").map((a) => a["resourceType"])).toEqual(["Attachment"]);
  });

  it("another facility's device is the same 404 as a missing one; nothing stored", async () => {
    const foreign = await upload(tech, { resourceType: "device", resourceId: D2 });
    const missing = await upload(tech, { resourceType: "device", resourceId: MISSING });
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(foreign.body).toEqual(missing.body);
    expect(mdb.rows("Attachment")).toEqual([]);
    expect(storage.__objects.size).toBe(0);
  });

  it.each([
    ["generic", { resourceType: "generic" }],
    ["ticket", { resourceType: "ticket" }],
    ["post", { resourceType: "post" }],
    ["certificate", { resourceType: "certificate", resourceId: MISSING }],
    ["calibration", { resourceType: "calibration", resourceId: MISSING }],
    ["workorder", { resourceType: "workorder", resourceId: MISSING }],
    ["kanbancard", { resourceType: "kanbancard", resourceId: MISSING }],
    ["a device without a resourceId", { resourceType: "device" }],
  ])("%s → 403 FACILITY_UPLOAD_REFUSED, the quarantined file removed", async (_label, body) => {
    const before = fs.readdirSync(tmp).length;
    const res = await upload(tech, body);
    expect({ status: res.status, code: res.body.code }).toEqual({ status: 403, code: "FACILITY_UPLOAD_REFUSED" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fs.readdirSync(tmp).length).toBe(before);
    expect(mdb.rows("Attachment")).toEqual([]);
  });

  it("no type at all, a file already gone, or no file: still 403 (the gate never fails open)", async () => {
    as(tech);
    const gone = await call(router, "POST", "/", {
      body: {},
      routeFile: "api/attachments.route.ts",
      file: { path: path.join(tmp, "never-written.jpg"), filename: "never-written.jpg", originalname: "x.jpg", mimetype: "image/jpeg", size: 1 },
    });
    expect((gone.body as { code?: string }).code).toBe("FACILITY_UPLOAD_REFUSED");
    as(tech);
    const none = await call(router, "POST", "/", { body: { resourceType: "generic" }, routeFile: "api/attachments.route.ts" });
    expect([none.status, (none.body as { code?: string }).code]).toEqual([403, "FACILITY_UPLOAD_REFUSED"]);
  });

  it("a bound ROOM USER (calibration read only) is refused even for its own device", async () => {
    const res = await upload(room, { resourceType: "device", resourceId: D1 });
    expect({ status: res.status, code: res.body.code }).toEqual({ status: 403, code: "FACILITY_UPLOAD_REFUSED" });
  });

  it("a permission lookup that fails is an error (500), never a pass", async () => {
    const roles = jest.requireActual<{ getRolePermissionsMatrix: (...a: unknown[]) => Promise<unknown> }>("../../services/roles.service");
    // dynamicAccess reads the matrix first (granted); the bound gate's own read then fails.
    const granted = await roles.getRolePermissionsMatrix("any");
    const spy = jest.spyOn(roles, "getRolePermissionsMatrix").mockResolvedValueOnce(granted).mockRejectedValueOnce(new Error("redis down"));
    const res = await upload(tech, { resourceType: "device", resourceId: D1 });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(mdb.rows("Attachment")).toEqual([]);
  });

  it("provider staff are unchanged: a generic upload still works", async () => {
    expect((await upload(staff, { resourceType: "generic" })).status).toBe(201);
  });
});
