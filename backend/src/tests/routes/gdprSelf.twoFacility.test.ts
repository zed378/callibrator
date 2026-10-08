/**
 * P21-09e — the GDPR self routes (P18-03 § 8.1 S-4) for a facility-bound data subject, with their
 * two-facility cases (G-07) and the completeness of the subject's own export (P18-03 § 10.2).
 *
 * REAL: the gdpr router (auth double → tenant context + facility route gate), gdpr.service, the
 * local storage driver under a temporary root, the hooks over memoryDb.
 *
 *  - another facility's user's erasure request, and its export, are the same 404 as missing ones;
 *    the caller's own are reached;
 *  - the export of a BOUND subject holds its audit rows of EVERY facility (the subject acted in F2
 *    before it was re-bound to F1) — the reviewed `pagesOf` skip — and none of another person's.
 *
 * @two-facility api/gdpr.route.ts GET /erasure/:requestId
 * @two-facility api/gdpr.route.ts GET /exports/:exportId/download
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import JSZip from "jszip";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as FacilitySuite from "../fixtures/twoFacilitySuite";
import type { FacilitySuiteContext } from "../fixtures/twoFacilitySuite";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/gdpr.route";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p2109e-gdpr-"));
jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoFacilitySuite } = jest.requireActual<typeof FacilitySuite>("../fixtures/twoFacilitySuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/gdpr.route");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const ME = "cccccccc-0000-4000-8000-0000000000f1";
const PEER = "cccccccc-0000-4000-8000-0000000000f2";
const MY_REQUEST = "a1000000-0000-4000-8000-0000000000f1";
const PEER_REQUEST = "a1000000-0000-4000-8000-0000000000f2";
const MY_EXPORT = "export-1790000000000-0a1b2c3d";
const PEER_EXPORT = "export-1790000000001-0a1b2c3e";
const DIR = path.join(mockRoot, "exports");
const DAY = 24 * 3600 * 1000;

let ctx: FacilitySuiteContext & { readonly bound: Principal };
let tenant = "";

const writeExport = (id: string, userId: string): void => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIR, `${id}.json`),
    JSON.stringify({ exportId: id, tenantId: tenant, userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + DAY).toISOString() }),
  );
  fs.writeFileSync(path.join(DIR, `${id}.zip`), "PK the subject's data");
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fs.rmSync(DIR, { recursive: true, force: true });
  const fx = twoTenants();
  tenant = fx.tenantA.id;
  const base = fx.principal(fx.tenantA, "ROOM_USER");
  ctx = { bound: { ...base, id: ME, clientFacilityId: F1 } as unknown as Principal };
  seedTenants(mdb, fx, []);
  mdb.rows("TenantSettings");
  const user = (id: string, f: string): Record<string, unknown> => ({
    id, tenantId: tenant, username: id.slice(-4), email: `${id.slice(-4)}@example.test`, password: "x", firstName: "F", lastName: id.slice(-2),
    roleId: base.role.id, clientFacilityId: f, status: "ACTIVE", isActive: true,
  });
  mdb.seed("User", [user(ME, F1), user(PEER, F2)]);
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: tenant, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: tenant, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
  mdb.seed("DsarRequest", [
    { id: MY_REQUEST, tenantId: tenant, userId: ME, type: "erasure", status: "pending", requestedAt: new Date("2026-09-20") },
    { id: PEER_REQUEST, tenantId: tenant, userId: PEER, type: "erasure", status: "pending", requestedAt: new Date("2026-09-20") },
  ]);
  writeExport(MY_EXPORT, ME);
  writeExport(PEER_EXPORT, PEER);
});

afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

twoFacilitySuite({
  module: "gdpr",
  router,
  routeFile: "api/gdpr.route.ts",
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /erasure/:requestId", method: "GET", path: (id) => `/erasure/${id}`, ownId: () => MY_REQUEST, foreignId: () => PEER_REQUEST },
    { key: "GET /exports/:exportId/download", method: "GET", path: (id) => `/exports/${id}/download`, ownId: () => MY_EXPORT, foreignId: () => PEER_EXPORT },
  ],
});

describe("S-4 — a bound subject's own export is complete (P18-03 § 10.2)", () => {
  it("holds its audit rows of every facility, none of another person's", async () => {
    mdb.seed("AuditLog", [
      { id: "a2000000-0000-4000-8000-000000000001", tenantId: tenant, userId: ME, actorType: "user", action: "UPDATE", resourceType: "User", resourceId: ME, clientFacilityId: F1, changes: { mark: "in-F1" } },
      { id: "a2000000-0000-4000-8000-000000000002", tenantId: tenant, userId: ME, actorType: "user", action: "UPDATE", resourceType: "User", resourceId: ME, clientFacilityId: F2, changes: { mark: "in-F2-before-rebinding" } },
      { id: "a2000000-0000-4000-8000-000000000003", tenantId: tenant, userId: PEER, actorType: "user", action: "UPDATE", resourceType: "User", resourceId: PEER, clientFacilityId: F2, changes: { mark: "peer" } },
    ]);
    as(ctx.bound);
    const res = await call(router, "POST", "/export", { routeFile: "api/gdpr.route.ts" });
    expect(res.status).toBe(200);
    const exportId = (res.body as { data: { exportId: string } }).data.exportId;
    // Read back the way the subject does: its own download.
    const archive = await call(router, "GET", `/exports/${exportId}/download`, { routeFile: "api/gdpr.route.ts" });
    expect(archive.status).toBe(200);
    const zip = await JSZip.loadAsync(archive.body as Buffer);
    const audit = (await zip.file("audit_logs.json")?.async("string")) ?? "";
    expect(audit).toContain("in-F1");
    expect(audit).toContain("in-F2-before-rebinding");
    expect(audit).not.toContain("\"peer\"");
  });
});
