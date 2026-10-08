/**
 * P21-09e — the domain rows of P18-03 § 8.2 (A-1 … A-4, A-6 … A-8) marked facility-accessible,
 * each with its two-facility suite (G-07): one tenant with SELF, F1 and F2; a HEALTHCARE
 * TECHNICIAN bound to F1; provider staff unbound.
 *
 * REAL: each router's chain (auth double → tenant context + facility route gate, validateUuid,
 * dynamicAccess with the bound ceiling, validate), the controllers, the services, the person
 * displays, the models and the tenant + facility hooks over memoryDb. DOUBLED: the file response
 * (a legacy file "on disk") and the stored certificate PDF's existence.
 *
 * For every `:id` route: F2's record answers the bound F1 principal 404, identical to a missing
 * id, nothing written; F1's record is reached; provider staff still reach it (FT-39). Every list
 * holds F1's row and not F2's. Plus A-2 / A-3's bound rules: a create lands in F1, naming F2 is a
 * 404; an edit cannot change the status or point the device at a location the context cannot read.
 *
 * @two-facility api/calibrationDevices.route.ts GET /:calibrationDeviceId
 * @two-facility api/calibrationDevices.route.ts PUT /:calibrationDeviceId
 * @two-facility api/calibrationRecords.route.ts GET /:calibrationRecordId
 * @two-facility api/attachments.route.ts GET /:id
 * @two-facility api/attachments.route.ts GET /:id/download
 * @two-facility api/attachments.route.ts POST /:id/signed-url
 * @two-facility api/certificates.route.ts GET /:certificateId
 * @two-facility api/certificates.route.ts GET /:certificateId/document
 * @two-facility api/certificates.route.ts GET /:certificateId/pdf
 * @two-facility api/maintenance.route.ts GET /:orderId
 */
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as FacilitySuite from "../fixtures/twoFacilitySuite";
import type { FacilitySuiteContext } from "../fixtures/twoFacilitySuite";
import type { Principal } from "../fixtures/routeClient";
import type * as FileResponse from "../../utils/fileResponse.util";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
import type * as AttachmentsRoute from "../../routes/api/attachments.route";
import type * as CertificatesRoute from "../../routes/api/certificates.route";
import type * as MaintenanceRoute from "../../routes/api/maintenance.route";

jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../utils/fileResponse.util", () => ({
  ...jest.requireActual<typeof FileResponse>("../../utils/fileResponse.util"),
  sendStoredFile: (res: { status: (c: number) => { json: (b: unknown) => unknown } }, absPath: string) => {
    res.status(200).json({ served: absPath });
    return Promise.resolve();
  },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoFacilitySuite } = jest.requireActual<typeof FacilitySuite>("../fixtures/twoFacilitySuite");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");
const records = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");
const attachments = jest.requireActual<typeof AttachmentsRoute>("../../routes/api/attachments.route");
const certificates = jest.requireActual<typeof CertificatesRoute>("../../routes/api/certificates.route");
const maintenance = jest.requireActual<typeof MaintenanceRoute>("../../routes/api/maintenance.route");

const SELF = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const BOUND = "cccccccc-0000-4000-8000-0000000000f1";
const ID = {
  d1: "d1000000-0000-4000-8000-0000000000f1",
  d2: "d1000000-0000-4000-8000-0000000000f2",
  r1: "e1000000-0000-4000-8000-0000000000f1",
  r2: "e1000000-0000-4000-8000-0000000000f2",
  a1: "a1000000-0000-4000-8000-0000000000f1",
  a2: "a1000000-0000-4000-8000-0000000000f2",
  c1: "c1000000-0000-4000-8000-0000000000f1",
  c2: "c1000000-0000-4000-8000-0000000000f2",
  w1: "b1000000-0000-4000-8000-0000000000f1",
  w2: "b1000000-0000-4000-8000-0000000000f2",
  room2: "a0000000-0000-4000-8000-0000000000f2",
  room1: "a0000000-0000-4000-8000-0000000000f1",
} as const;
const STORED = "p2109e-two-facility.pdf";

interface DomainContext extends FacilitySuiteContext {
  readonly bound: Principal;
  readonly unbound: Principal;
}
let ctx: DomainContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const realExists = fs.existsSync.bind(fs);
  jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith(STORED) || realExists(p));
  const fx = twoTenants();
  const staff = fx.principal(fx.tenantA, "TECHNICIAN");
  const bound = { ...fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"), id: BOUND, clientFacilityId: F1 } as unknown as Principal;
  ctx = { bound, unbound: staff };
  seedTenants(mdb, fx, [staff, fx.principal(fx.tenantB, "HEALTCARE_ADMIN")]);
  const T = fx.tenantA.id;
  mdb.seed("User", { id: BOUND, tenantId: T, username: "boundf1", email: "boundf1@example.test", password: "x", firstName: "Bound", lastName: "One", roleId: bound.role.id, clientFacilityId: F1, status: "ACTIVE", isActive: true });
  mdb.seed("ClientFacility", [
    { id: SELF, tenantId: T, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: T, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
  mdb.seed("Warehouse", [
    { id: ID.room2, tenantId: T, name: "Room Two", code: "R-2", clientFacilityId: F2, status: "active", isDeleted: false },
    { id: ID.room1, tenantId: T, name: "Room One", code: "R-1", clientFacilityId: F1, status: "active", isDeleted: false },
  ]);
  const per = (f: string, n: "1" | "2"): void => {
    const d = n === "1" ? ID.d1 : ID.d2;
    mdb.seed("CalibrationDevice", { id: d, tenantId: T, clientFacilityId: f, name: `Pump ${n}`, serialNumber: `SN-${n}`, status: "active", isDeleted: false });
    mdb.seed("CalibrationRecord", { id: n === "1" ? ID.r1 : ID.r2, tenantId: T, clientFacilityId: f, deviceId: d, performedBy: staff.id, calibrationDate: new Date("2026-09-01"), isCompliant: true });
    mdb.seed("Certificate", { id: n === "1" ? ID.c1 : ID.c2, tenantId: T, clientFacilityId: f, deviceId: d, certificateNumber: `CERT-${n}`, status: "signed", calibratedBy: staff.id, createdBy: staff.id, filePath: `certificates/${STORED}` });
    mdb.seed("MaintenanceWorkOrder", { id: n === "1" ? ID.w1 : ID.w2, tenantId: T, clientFacilityId: f, deviceId: d, title: "Replace filter", type: "Preventative", status: "Open", priority: "Medium", assignedTo: staff.id });
    mdb.seed("Attachment", { id: n === "1" ? ID.a1 : ID.a2, tenantId: T, clientFacilityId: f, resourceType: "device", resourceId: d, fileName: STORED, originalName: "photo.pdf", folder: "uploads/attachments", mimeType: "application/pdf", size: 3, uploadedBy: staff.id });
  };
  per(F1, "1");
  per(F2, "2");
});

const own = (key: keyof typeof ID) => (): string => ID[key];

twoFacilitySuite({
  module: "calibration-devices",
  router: devices,
  routeFile: "api/calibrationDevices.route.ts",
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:calibrationDeviceId", method: "GET", path: (id) => `/${id}`, ownId: own("d1"), foreignId: own("d2"), unboundToo: true },
    {
      key: "PUT /:calibrationDeviceId",
      method: "PUT",
      path: (id) => `/${id}`,
      ownId: own("d1"),
      foreignId: own("d2"),
      body: { name: "Pump One renamed" },
      writes: ["CalibrationDevice", "AuditLog"],
      unboundToo: true,
    },
  ],
  lists: [{ key: "GET /", path: "/", ownId: own("d1"), foreignId: own("d2") }],
});

twoFacilitySuite({
  module: "calibration-records",
  router: records,
  routeFile: "api/calibrationRecords.route.ts",
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /:calibrationRecordId", method: "GET", path: (id) => `/${id}`, ownId: own("r1"), foreignId: own("r2"), unboundToo: true }],
  lists: [{ key: "GET /", path: "/", ownId: own("r1"), foreignId: own("r2") }],
});

twoFacilitySuite({
  module: "attachments",
  router: attachments,
  routeFile: "api/attachments.route.ts",
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:id", method: "GET", path: (id) => `/${id}`, ownId: own("a1"), foreignId: own("a2"), unboundToo: true },
    { key: "GET /:id/download", method: "GET", path: (id) => `/${id}/download`, ownId: own("a1"), foreignId: own("a2"), unboundToo: true },
    { key: "POST /:id/signed-url", method: "POST", path: (id) => `/${id}/signed-url`, ownId: own("a1"), foreignId: own("a2"), unboundToo: true },
  ],
  lists: [{ key: "GET /", path: "/", ownId: own("a1"), foreignId: own("a2") }],
});

twoFacilitySuite({
  module: "certificates",
  router: certificates,
  routeFile: "api/certificates.route.ts",
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:certificateId", method: "GET", path: (id) => `/${id}`, ownId: own("c1"), foreignId: own("c2"), unboundToo: true },
    { key: "GET /:certificateId/document", method: "GET", path: (id) => `/${id}/document`, ownId: own("c1"), foreignId: own("c2"), unboundToo: true },
    { key: "GET /:certificateId/pdf", method: "GET", path: (id) => `/${id}/pdf`, ownId: own("c1"), foreignId: own("c2"), unboundToo: true },
  ],
  lists: [{ key: "GET /", path: "/", ownId: own("c1"), foreignId: own("c2") }],
});

twoFacilitySuite({
  module: "maintenance",
  router: maintenance,
  routeFile: "api/maintenance.route.ts",
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /:orderId", method: "GET", path: (id) => `/${id}`, ownId: own("w1"), foreignId: own("w2"), unboundToo: true }],
  lists: [{ key: "GET /", path: "/", ownId: own("w1"), foreignId: own("w2") }],
});

interface Body { data?: Record<string, unknown> | null; message?: string; code?: string }
const deviceCall = (principal: Principal, method: string, url: string, body: unknown = {}): Promise<{ status: number; body: Body }> => {
  as(principal);
  return call(devices, method, url, { body, routeFile: "api/calibrationDevices.route.ts" }) as Promise<{ status: number; body: Body }>;
};

describe("A-2 / A-3 — a bound HEALTHCARE TECHNICIAN writes devices of its facility only", () => {
  it("a create lands in F1 (stamped), audited", async () => {
    const res = await deviceCall(ctx.bound, "POST", "/", { name: "New pump", serialNumber: "SN-NEW" });
    expect(res.status).toBe(201);
    expect(res.body.data?.["clientFacilityId"]).toBe(F1);
    expect(mdb.rows("AuditLog").map((a) => a["resourceType"])).toContain("CalibrationDevice");
  });

  it("a create naming F2 is a 404 (never a hint it exists); nothing written", async () => {
    const before = mdb.committed().length;
    const res = await deviceCall(ctx.bound, "POST", "/", { name: "New pump", clientFacilityId: F2 });
    expect({ status: res.status, message: res.body.message }).toEqual({ status: 404, message: "Client facility not found" });
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("an edit cannot change the status (400) or point at another facility's room (404); provider staff still can", async () => {
    expect((await deviceCall(ctx.bound, "PUT", `/${ID.d1}`, { status: "retired" })).status).toBe(400);
    expect((await deviceCall(ctx.bound, "PUT", `/${ID.d1}`, { locationId: ID.room2 })).status).toBe(404);
    expect((await deviceCall(ctx.bound, "POST", "/", { name: "Roomed pump", locationId: ID.room2 })).status).toBe(404);
    expect((await deviceCall(ctx.unbound, "PUT", `/${ID.d1}`, { status: "maintenance" })).status).toBe(200);
    expect((await deviceCall(ctx.bound, "PUT", `/${ID.d1}`, { locationId: ID.room1 })).status).toBe(200);
  });

  it("the unmarked device routes stay refused for the bound principal (delete, restore, bulk import)", async () => {
    for (const [method, url] of [["DELETE", `/${ID.d1}`], ["POST", `/${ID.d1}/restore`], ["POST", "/bulk-import"]] as const) {
      const res = await deviceCall(ctx.bound, method, url);
      expect({ url, status: res.status, code: res.body.code }).toEqual({ url, status: 403, code: "FACILITY_ROUTE_REFUSED" });
    }
  });
});
