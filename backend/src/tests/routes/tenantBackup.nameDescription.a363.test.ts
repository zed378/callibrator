/**
 * A-363 — a tenant backup keeps the `name` and `description` it was created with.
 *
 * `POST /tenants/:tenantId/backups` requires `name` (400 without it) and
 * accepts `description`, and TenantBackup.createBackup passed both to
 * `create` — but neither was a model attribute, so Sequelize dropped them on
 * insert: the 201, the list and the backup page all showed a blank name.
 * Migration 0108 adds the columns; the model maps them.
 *
 * REAL router, validate, rbac/abac (matrix granted), controller, service,
 * audit service and models with their tenant hooks (fixtures/memoryDb).
 * Doubled, as in tenantBackup.twoTenant.test.ts: the archive FILE writes.
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/tenantBackup.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenantBackup.route");

let tenantA = "";
let adminA: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
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
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [adminA, fx.principal(fx.tenantB, "HEALTCARE_ADMIN")]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-363: a backup's name and description are stored and answered", () => {
  it("the create answers them, the row holds them, the list answers them, and the audit row names the backup", async () => {
    as(adminA);
    const created = await call(router, "POST", `/${tenantA}/backups`, {
      body: { name: "  Before upgrade  ", description: "Taken before the v3 rollout", backupType: "FULL" },
    });

    expect(created.status).toBe(201);
    const data = (created.body as { data: { id: string; name: string | null; description: string | null } }).data;
    expect({ name: data.name, description: data.description }).toEqual({
      name: "Before upgrade",
      description: "Taken before the v3 rollout",
    });

    const [row] = mdb.rows("TenantBackup");
    expect({ name: row?.["name"], description: row?.["description"] }).toEqual({
      name: "Before upgrade",
      description: "Taken before the v3 rollout",
    });

    const list = await call(router, "GET", `/${tenantA}/backups`);
    expect(list.status).toBe(200);
    expect((list.body as { data: { name: string | null }[] }).data.map((b) => b.name)).toEqual(["Before upgrade"]);

    const audits = mdb.rows("AuditLog").filter((a) => a["resourceType"] === "TenantBackup");
    expect(audits).toHaveLength(1);
    expect((audits[0]?.["changes"] as Record<string, unknown>)["name"]).toBe("Before upgrade");
  });

  it("a backup created without a description stores NULL for it", async () => {
    as(adminA);
    const created = await call(router, "POST", `/${tenantA}/backups`, { body: { name: "Nightly" } });

    expect(created.status).toBe(201);
    expect(mdb.rows("TenantBackup").map((r) => [r["name"], r["description"] ?? null])).toEqual([["Nightly", null]]);
  });
});
