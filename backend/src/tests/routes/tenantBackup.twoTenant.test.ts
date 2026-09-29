/**
 * Two tenants — every /tenants/:tenantId/backups route (CLAUDE.md: "Every new
 * :id route needs a two-tenant test asserting 404").
 *
 * The routes name a tenant AND (for five of them) a backup, so each is probed
 * both ways an id can cross the boundary, as tenant B's ADMINISTRATOR (rbac
 * TENANT_ADMIN and abac tenant permissions pass; only the tenant decides):
 *
 *  - TENANT: tenant A's id in the path (the abac checkTenant gate);
 *  - BACKUP: the caller's OWN tenant id with tenant A's backup id (the
 *    handlers look the backup up by id alone and rely on the tenant hook —
 *    this is what proves that reliance holds).
 *
 * Each answers the 404 a never-existing id gets, and writes nothing. The owner
 * (tenant A's administrator) reaches each route: 2xx, or — for the restore,
 * whose archive this test does not build — the 409 that explains a backup
 * already restored, which a lookup that found nothing could not give.
 *
 * REAL router, validateUuid, rbac, abac (role matrix granted), validate,
 * controller, tenantBackup service and audit service on the REAL models and
 * tenant hooks (fixtures/memoryDb). Doubled: the archive FILE — its existence
 * and the writes of a new one (fs), and streaming it (res.download).
 *
 * @two-tenant api/tenantBackup.route.js POST /:tenantId/backups
 * @two-tenant api/tenantBackup.route.js GET /:tenantId/backups
 * @two-tenant api/tenantBackup.route.js GET /:tenantId/backups/stats
 * @two-tenant api/tenantBackup.route.js GET /:tenantId/backups/:backupId
 * @two-tenant api/tenantBackup.route.js GET /:tenantId/backups/:backupId/download
 * @two-tenant api/tenantBackup.route.js POST /:tenantId/backups/:backupId/restore
 * @two-tenant api/tenantBackup.route.js DELETE /:tenantId/backups/:backupId
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, RouteResponse } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/tenantBackup.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call, probeCrossTenant } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { MISSING_ID } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenantBackup.route");

const BACKUP_A = "a1000000-0000-4000-8000-000000000001";
const RESTORED_A = "a1000000-0000-4000-8000-000000000002";
const ARCHIVE = "/backups/tenant-a/backup-a.zip";

let tenantA = "";
let tenantB = "";
let adminA: Principal;
let adminB: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const realExists = fs.existsSync.bind(fs);
  jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p) === ARCHIVE || realExists(p));
  // A written archive is kept in memory, and read back (its checksum) from there.
  const written = new Map<string, Buffer>();
  const realRead = fs.createReadStream.bind(fs);
  jest.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
    written.set(String(file), Buffer.from(data as Buffer));
  });
  jest.spyOn(fs, "createReadStream").mockImplementation((file, options) => {
    const archive = written.get(String(file));
    return archive ? (Readable.from([archive]) as fs.ReadStream) : realRead(file, options);
  });
  jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
  jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  tenantB = fx.tenantB.id;
  adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  adminB = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [adminA, adminB]);
  mdb.seed("TenantBackup", [
    {
      id: BACKUP_A,
      tenantId: tenantA,
      name: "Nightly A",
      status: "completed",
      backupType: "full",
      filePath: ARCHIVE,
      fileSize: 2048,
      metadata: { fileSize: 2048 },
      createdBy: adminA.id,
    },
    {
      id: RESTORED_A,
      tenantId: tenantA,
      name: "Restored A",
      status: "completed",
      backupType: "full",
      filePath: ARCHIVE,
      restoredAt: new Date("2026-09-20"),
      createdBy: adminA.id,
    },
  ]);
});

interface BackupRoute {
  readonly key: string;
  readonly method: string;
  readonly path: (tenantId: string, backupId: string) => string;
  /** The tenant-A backup the route names, if it names one. */
  readonly backup?: string;
  readonly body?: unknown;
  readonly ownerStatus?: number;
  readonly writes?: readonly string[];
}

const ROUTES: readonly BackupRoute[] = [
  {
    key: "POST /:tenantId/backups",
    method: "POST",
    path: (t) => `/${t}/backups`,
    body: { name: "Before upgrade", backupType: "FULL" },
    writes: ["TenantBackup"],
  },
  { key: "GET /:tenantId/backups", method: "GET", path: (t) => `/${t}/backups` },
  { key: "GET /:tenantId/backups/stats", method: "GET", path: (t) => `/${t}/backups/stats` },
  { key: "GET /:tenantId/backups/:backupId", method: "GET", path: (t, b) => `/${t}/backups/${b}`, backup: BACKUP_A },
  {
    key: "GET /:tenantId/backups/:backupId/download",
    method: "GET",
    path: (t, b) => `/${t}/backups/${b}/download`,
    backup: BACKUP_A,
  },
  {
    key: "POST /:tenantId/backups/:backupId/restore",
    method: "POST",
    path: (t, b) => `/${t}/backups/${b}/restore`,
    backup: RESTORED_A,
    ownerStatus: 409,
  },
  {
    key: "DELETE /:tenantId/backups/:backupId",
    method: "DELETE",
    path: (t, b) => `/${t}/backups/${b}`,
    backup: BACKUP_A,
    writes: ["TenantBackup", "AuditLog"],
  },
];

const send = (route: BackupRoute, url: string): Promise<RouteResponse> =>
  call(router, route.method, url, { body: route.body ?? {} });

const expectRefused = async (request: (id: string) => Promise<RouteResponse>, foreignId: string): Promise<void> => {
  const probe = await probeCrossTenant(mdb, request, foreignId, MISSING_ID);
  expect(probe.foreign.status).toBe(404);
  expect(probe.foreign.body).toEqual(probe.missing.body);
  expect(probe.tablesAfter).toEqual(probe.tablesBefore);
  expect(probe.committed).toEqual([]);
};

describe.each(ROUTES.map((r) => [r.key, r] as const))("tenant backups %s — two tenants", (_key, route) => {
  it("TENANT: another tenant's id in the path answers 404, identical to one that does not exist, and nothing is written", async () => {
    as(adminB);
    await expectRefused((t) => send(route, route.path(t, route.backup ?? "")), tenantA);
  });

  if (route.backup) {
    const backup = route.backup;
    it("BACKUP: the caller's own tenant with another tenant's backup answers 404, and nothing is written", async () => {
      as(adminB);
      await expectRefused((b) => send(route, route.path(tenantB, b)), backup);
    });
  }

  it("the owning tenant reaches it", async () => {
    as(adminA);
    const res = await send(route, route.path(tenantA, route.backup ?? ""));

    if (route.ownerStatus !== undefined) {
      expect({ status: res.status, body: res.body }).toEqual({ status: route.ownerStatus, body: res.body });
    } else {
      expect([res.status >= 200 && res.status < 300, res.status, res.body]).toEqual([true, res.status, res.body]);
    }
    for (const model of route.writes ?? []) {
      expect(mdb.committed().map((w) => w.model)).toContain(model);
    }
  });
});
