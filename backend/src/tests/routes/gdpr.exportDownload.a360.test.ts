/**
 * A-360 (ADR-114) — the GDPR export can be downloaded, by its subject only.
 *
 * `POST /gdpr/export` answered `downloadUrl: /api/v1/gdpr/exports/<id>/download`
 * and no route served it (404 from the router), so the data subject never
 * received their data. This drives the REAL gdpr router, controller and
 * service on the REAL models and tenant hooks (fixtures/memoryDb), with the
 * exports directory in a temporary folder:
 *
 *  - two tenants: tenant B's principal asking for tenant A's export id is the
 *    same 404 as an id that never existed, and writes nothing; the owner
 *    receives the archive and one EXPORT audit row commits (twoTenantSuite);
 *  - the same tenant, another member: 404, nothing written;
 *  - end to end: POST /export, then GET the `downloadUrl` it answered; the
 *    ZIP holds the caller's profile, and NO file in it carries a credential
 *    (the S-20 / A-331 scanner, tests/support/secretScan.ts, over every JSON
 *    file in the archive).
 *
 * @two-tenant api/gdpr.route.ts GET /exports/:exportId/download
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import JSZip from "jszip";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/gdpr.route";
import { findSecrets } from "../support/secretScan";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a360-exports-"));
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
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/gdpr.route");

const DIR = path.join(mockRoot, "exports");
const EXPORT_A = "export-1790000000000-0a1b2c3d";
const DAY = 24 * 3600 * 1000;

type World = ReturnType<typeof twoTenants>;

interface Ctx extends SuiteContext {
  colleague: Principal;
  fx: World;
}
let ctx: Ctx;

/** Lay an export down as exportUserData leaves it: the manifest and the ZIP. */
const writeExport = (id: string, owner: Principal, expiresAt = new Date(Date.now() + DAY).toISOString()): void => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIR, `${id}.json`),
    JSON.stringify({ exportId: id, tenantId: owner.tenantId, userId: owner.id, createdAt: new Date().toISOString(), expiresAt }),
  );
  fs.writeFileSync(path.join(DIR, `${id}.zip`), "PK the subject's data");
};

const download = (id: string) => call(router, "GET", `/exports/${id}/download`);

beforeEach(() => {
  mdb.reset();
  fs.rmSync(DIR, { recursive: true, force: true });
  const fx = twoTenants();
  ctx = {
    owner: fx.principal(fx.tenantA, "USER"),
    other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN"),
    colleague: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"),
    fx,
  };
  seedTenants(mdb, fx, [ctx.owner, ctx.other, ctx.colleague]);
  writeExport(EXPORT_A, ctx.owner);
});

afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

twoTenantSuite<Ctx>({
  module: "gdpr",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "GET /exports/:exportId/download",
      method: "GET",
      path: (id) => `/exports/${id}/download`,
      id: () => EXPORT_A,
      missingId: "export-1790000000000-ffffffff",
      writes: ["AuditLog"],
    },
  ],
});

describe("A-360: GET /gdpr/exports/:exportId/download", () => {
  it("the subject receives their archive as a no-store attachment, and one EXPORT row records it", async () => {
    as(ctx.owner);
    const res = await download(EXPORT_A);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ download: path.join(DIR, `${EXPORT_A}.zip`) });
    expect(res.headers).toMatchObject({ "content-type": "application/zip", "cache-control": "no-store" });
    const audits = mdb.committed().filter((w) => w.model === "AuditLog");
    expect(audits).toHaveLength(1);
    expect(mdb.rows("AuditLog")).toEqual([
      expect.objectContaining({
        tenantId: ctx.owner.tenantId,
        userId: ctx.owner.id,
        action: "EXPORT",
        resourceType: "DataExport",
        resourceId: EXPORT_A,
      }),
    ]);
  });

  it("another member of the SAME tenant is answered 404, exactly as an unknown id, and nothing is written", async () => {
    as(ctx.colleague);
    const before = mdb.committed().length;
    const theirs = await download(EXPORT_A);
    const unknown = await download("export-1790000000000-ffffffff");

    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(unknown.body);
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("an expired export, and an id that is not an export id, are the same 404", async () => {
    writeExport("export-1700000000000-00000001", ctx.owner, new Date(Date.now() - 1000).toISOString());
    as(ctx.owner);
    const expired = await download("export-1700000000000-00000001");
    const traversal = await download("..%2F..%2Fpackage.json");
    const unknown = await download("export-1790000000000-ffffffff");

    expect([expired.status, traversal.status]).toEqual([404, 404]);
    expect(expired.body).toEqual(unknown.body);
    expect(traversal.body).toEqual(unknown.body);
  });

  it("end to end: the downloadUrl POST /export answers serves the caller's data, and no file in it carries a credential", async () => {
    // A subject whose `password` column holds a bcrypt-SHAPED value and whose
    // MFA seed is set, so the scanner would flag either if the export carried it.
    const hash = `$2b$10$${"a".repeat(53)}`;
    const subject = ctx.fx.principal(ctx.fx.tenantA, "USER");
    mdb.seed("User", {
      id: subject.id,
      tenantId: subject.tenantId,
      username: subject.username,
      email: `${subject.username}@a360.test`,
      password: hash,
      mfaSecret: "envelope:secret",
      roleId: subject.role.id,
      status: "ACTIVE",
      isActive: true,
    });
    as(subject);
    const created = await call(router, "POST", "/export");
    expect(created.status).toBe(200);
    const { exportId, downloadUrl } = (created.body as { data: { exportId: string; downloadUrl: string } }).data;
    expect(downloadUrl).toBe(`/api/v1/gdpr/exports/${exportId}/download`);

    const res = await call(router, "GET", downloadUrl.replace("/api/v1/gdpr", ""));
    expect(res.status).toBe(200);
    const file = (res.body as { download: string }).download;
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]?.dir);
    expect(names).toContain("user_profile.json");

    const read = async (name: string): Promise<unknown> => JSON.parse((await zip.file(name)?.async("string")) ?? "null") as unknown;
    const profile = (await read("user_profile.json")) as { user: { id: string } };
    expect(profile.user.id).toBe(subject.id);
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      const body = await read(name);
      expect({ name, findings: findSecrets(body) }).toEqual({ name, findings: [] });
      expect(JSON.stringify(body)).not.toContain(hash);
      expect(JSON.stringify(body)).not.toContain("envelope:secret");
    }
  });
});
