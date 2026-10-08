/**
 * P21-09e — G-24 (spec P19-04 § 12; the A-90 sweep for facility-bound viewers), through the REAL
 * records, certificates, work-order and attachment routes over memoryDb:
 *
 *  - a facility's own records, authored by PROVIDER staff (no facility), are PRESENT in its bound
 *    staff's lists, and carry a non-redacted display: the author's name, role and the tenant as
 *    organisation — while the raw `performer` include stays null for the bound viewer (FT-16);
 *  - a record that came in with a device move, performed by a person bound to ANOTHER facility, is
 *    shown REDACTED to the bound viewer — `{ name: null, role, organisation: null, redacted: true }`
 *    — and in full to provider staff;
 *  - an author outside the tenant (the platform operator) is "Platform support";
 *  - a signed certificate shows the people its snapshot printed;
 *  - the display carries exactly the contract's keys — never an id, e-mail or username (FT-15).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
import type * as CertificatesRoute from "../../routes/api/certificates.route";
import type * as MaintenanceRoute from "../../routes/api/maintenance.route";
import type * as AttachmentsRoute from "../../routes/api/attachments.route";
import { PERSON_DISPLAY_KEYS } from "@callibrator/contracts/people";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const records = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");
const certificates = jest.requireActual<typeof CertificatesRoute>("../../routes/api/certificates.route");
const maintenance = jest.requireActual<typeof MaintenanceRoute>("../../routes/api/maintenance.route");
const attachments = jest.requireActual<typeof AttachmentsRoute>("../../routes/api/attachments.route");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const BOUND = "cccccccc-0000-4000-8000-0000000000f1";
const OTHER_BOUND = "cccccccc-0000-4000-8000-0000000000f2";
const PLATFORM = "99999999-0000-4000-8000-0000000000aa";
const DEVICE = "d1000000-0000-4000-8000-000000000001";
const R_STAFF = "e1000000-0000-4000-8000-000000000001";
const R_MOVED_IN = "e1000000-0000-4000-8000-000000000002";
const R_PLATFORM = "e1000000-0000-4000-8000-000000000003";
const CERT_SIGNED = "c1000000-0000-4000-8000-000000000001";

let bound: Principal;
let staff: Principal;
let tenantName = "";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  staff = fx.principal(fx.tenantA, "TECHNICIAN");
  bound = { ...fx.principal(fx.tenantA, "ROOM_USER"), id: BOUND, clientFacilityId: F1 } as unknown as Principal;
  tenantName = fx.tenantA.name;
  seedTenants(mdb, fx, [staff]);
  const T = fx.tenantA.id;
  mdb.seed("Role", [
    { id: staff.role.id, name: staff.role.name, status: "active", roleLevel: 3 },
    { id: bound.role.id, name: bound.role.name, status: "active", roleLevel: 1 },
  ]);
  // The staff member's names (the fixture seeds none).
  const staffRow = mdb.rows("User").find((u) => u["id"] === staff.id) as Record<string, unknown>;
  mdb.reset();
  seedTenants(mdb, fx, []);
  mdb.seed("Role", [
    { id: staff.role.id, name: staff.role.name, status: "active", roleLevel: 3 },
    { id: bound.role.id, name: bound.role.name, status: "active", roleLevel: 1 },
  ]);
  mdb.seed("User", [
    { ...staffRow, firstName: "Ana", lastName: "Kalibrator", email: "ana@example.test", clientFacilityId: null },
    { id: BOUND, tenantId: T, username: "roomf1", email: "roomf1@example.test", password: "x", firstName: "Room", lastName: "One", roleId: bound.role.id, clientFacilityId: F1, status: "ACTIVE", isActive: true },
    { id: OTHER_BOUND, tenantId: T, username: "techf2", email: "techf2@example.test", password: "x", firstName: "Tech", lastName: "Two", roleId: bound.role.id, clientFacilityId: F2, status: "ACTIVE", isActive: true },
  ]);
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: T, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: T, clientFacilityId: F1, name: "Pump", serialNumber: "SN-1", status: "active", isDeleted: false });
  const rec = (id: string, performedBy: string): Record<string, unknown> => ({ id, tenantId: T, clientFacilityId: F1, deviceId: DEVICE, performedBy, calibrationDate: new Date("2026-09-01"), isCompliant: true });
  mdb.seed("CalibrationRecord", [rec(R_STAFF, staff.id), rec(R_MOVED_IN, OTHER_BOUND), rec(R_PLATFORM, PLATFORM)]);
  mdb.seed("Certificate", {
    id: CERT_SIGNED,
    tenantId: T,
    clientFacilityId: F1,
    deviceId: DEVICE,
    certificateNumber: "CERT-1",
    status: "signed",
    calibratedBy: staff.id,
    signedSnapshot: { version: 1, issuer: { name: "The Lab", email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null }, device: null, calibratedBy: "A. Kalibrator (as printed)", approvedBy: "B. Approver", signedBy: "C. Signer" },
  });
  mdb.seed("MaintenanceWorkOrder", { id: "b1000000-0000-4000-8000-000000000001", tenantId: T, clientFacilityId: F1, deviceId: DEVICE, title: "Filter", type: "Preventative", status: "Open", priority: "Medium", assignedTo: staff.id });
  mdb.seed("Attachment", { id: "a1000000-0000-4000-8000-000000000001", tenantId: T, clientFacilityId: F1, resourceType: "device", resourceId: DEVICE, fileName: "p.jpg", originalName: "p.jpg", folder: "uploads/attachments", mimeType: "image/jpeg", size: 1, uploadedBy: staff.id });
});

type Row = Record<string, unknown>;
const get = async (router: unknown, file: string, url: string, who: Principal): Promise<Row[] | Row> => {
  as(who);
  const res = await call(router, "GET", url, { routeFile: file });
  expect(res.status).toBe(200);
  return (res.body as { data: Row[] | Row }).data;
};
const byId = (rows: Row[] | Row, id: string): Row => (rows as Row[]).find((r) => r["id"] === id) as Row;

describe("G-24 — a facility's own records, authored by provider staff, with their displays", () => {
  it("records: all three are in the bound viewer's list; provider staff shown in full, the raw include null", async () => {
    const rows = await get(records, "api/calibrationRecords.route.ts", "/", bound);
    expect((rows as Row[]).map((r) => r["id"]).sort()).toEqual([R_STAFF, R_MOVED_IN, R_PLATFORM].sort());
    const mine = byId(rows, R_STAFF);
    expect(mine["performerDisplay"]).toEqual({ name: "Ana Kalibrator", role: staff.role.name, organisation: tenantName, redacted: false });
    expect(mine["performer"] ?? null).toBeNull();
  });

  it("a record performed by a person bound to ANOTHER facility is redacted for the bound viewer, in full for provider staff", async () => {
    expect(byId(await get(records, "api/calibrationRecords.route.ts", "/", bound), R_MOVED_IN)["performerDisplay"]).toEqual({
      name: null,
      role: bound.role.name,
      organisation: null,
      redacted: true,
    });
    expect(byId(await get(records, "api/calibrationRecords.route.ts", "/", staff), R_MOVED_IN)["performerDisplay"]).toEqual({
      name: "Tech Two",
      role: bound.role.name,
      organisation: "Facility Two",
      redacted: false,
    });
  });

  it("an author outside the tenant is Platform support; the single read carries the display too", async () => {
    expect(byId(await get(records, "api/calibrationRecords.route.ts", "/", bound), R_PLATFORM)["performerDisplay"]).toEqual({
      name: "Platform support",
      role: null,
      organisation: null,
      redacted: false,
    });
    expect(((await get(records, "api/calibrationRecords.route.ts", `/${R_STAFF}`, bound)) as Row)["performerDisplay"]).toMatchObject({ name: "Ana Kalibrator" });
  });

  it("a signed certificate shows the people its snapshot printed", async () => {
    const cert = (await get(certificates, "api/certificates.route.ts", `/${CERT_SIGNED}`, bound)) as Row;
    expect(cert["calibratedByDisplay"]).toEqual({ name: "A. Kalibrator (as printed)", role: null, organisation: "The Lab", redacted: false });
    expect(cert["signedByDisplay"]).toMatchObject({ name: "C. Signer" });
  });

  it("work orders and files carry the assignee and the uploader", async () => {
    const order = ((await get(maintenance, "api/maintenance.route.ts", "/", bound)) as Row[])[0] as Row;
    expect(order["assigneeDisplay"]).toMatchObject({ name: "Ana Kalibrator", redacted: false });
    const file = ((await get(attachments, "api/attachments.route.ts", "/", bound)) as Row[])[0] as Row;
    expect(file["uploaderDisplay"]).toMatchObject({ name: "Ana Kalibrator", redacted: false });
  });

  it("FT-15: a display carries exactly the contract's keys — no id, e-mail or username", async () => {
    const rows = (await get(records, "api/calibrationRecords.route.ts", "/", bound)) as Row[];
    for (const row of rows) {
      expect(Object.keys(row["performerDisplay"] as object).sort()).toEqual([...PERSON_DISPLAY_KEYS].sort());
      expect(JSON.stringify(row["performerDisplay"])).not.toMatch(/@example\.test|cccccccc|roomf1|techf2/);
    }
  });
});
