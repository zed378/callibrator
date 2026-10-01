/**
 * Q-51 (ADR-100 Amendment 2) — lists and details name the API key that wrote
 * a row. A key-written row (the user actor column NULL, `api_key_id` set) used
 * to read with no actor at all. The reads now include `apiKey` with its id,
 * name and display prefix ONLY — never `keyHash` — as a LEFT JOIN (a
 * user-written row is still listed), tenant-scoped, and a revoked
 * (soft-deleted) key still names its rows.
 *
 * The real routers, services, models and tenant hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as RecordRoutes from "../../routes/api/calibrationRecords.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const records = jest.requireActual<typeof RecordRoutes>("../../routes/api/calibrationRecords.route");

const KEY_ID = "ab000000-0000-4000-8000-0000000000e1";
const FOREIGN_KEY_ID = "ab000000-0000-4000-8000-0000000000e2";
const DEVICE = "a5300000-0000-4000-8000-000000000001";
const BY_USER = "a5300000-0000-4000-8000-000000000002";
const BY_KEY = "a5300000-0000-4000-8000-000000000003";
const BY_FOREIGN_KEY = "a5300000-0000-4000-8000-000000000004";
const HASH = "f".repeat(64);

let fx: TwoTenantWorld;
let admin: Principal;

/** A record as the envelope returns it. */
interface RecordBody {
  id: string;
  performer: { id: string } | null;
  apiKey: Record<string, unknown> | null;
}

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  const tenantId = fx.tenantA.id;
  mdb.seed("ApiKey", [
    { id: KEY_ID, tenantId, name: "LIMS integration", keyPrefix: "cbk_1a2b3c", keyHash: HASH, scopes: [], isActive: true, isDeleted: false },
    // Another tenant's key: a row of tenant A can never name it (the join is tenant-scoped).
    { id: FOREIGN_KEY_ID, tenantId: fx.tenantB.id, name: "Other hospital", keyPrefix: "cbk_999999", keyHash: HASH, scopes: [], isActive: true, isDeleted: false },
  ]);
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId, name: "Infusion pump", serialNumber: "SN-R51" });
  mdb.seed("CalibrationRecord", [
    { id: BY_USER, tenantId, deviceId: DEVICE, performedBy: admin.id, apiKeyId: null, calibrationDate: new Date("2026-09-01") },
    { id: BY_KEY, tenantId, deviceId: DEVICE, performedBy: null, apiKeyId: KEY_ID, calibrationDate: new Date("2026-09-02") },
    { id: BY_FOREIGN_KEY, tenantId, deviceId: DEVICE, performedBy: null, apiKeyId: FOREIGN_KEY_ID, calibrationDate: new Date("2026-09-03") },
  ]);
});

const list = async (): Promise<RecordBody[]> => {
  as(admin);
  const res = await call(records, "GET", "/");
  expect(res.status).toBe(200);
  return (res.body as { data: RecordBody[] }).data;
};

it("the list names the key (id, name, prefix — never the hash) and still lists the user's record", async () => {
  const rows = await list();
  const byKey = rows.find((r) => r.id === BY_KEY);
  expect(byKey?.apiKey).toEqual({ id: KEY_ID, name: "LIMS integration", keyPrefix: "cbk_1a2b3c" });
  expect(JSON.stringify(rows)).not.toContain(HASH);
  const byUser = rows.find((r) => r.id === BY_USER);
  expect(byUser?.performer?.id).toBe(admin.id);
  expect(byUser?.apiKey).toBeNull();
});

it("another tenant's key is never joined (it reads as null)", async () => {
  const rows = await list();
  expect(rows.find((r) => r.id === BY_FOREIGN_KEY)?.apiKey).toBeNull();
});

it("the detail names the key, and a revoked (soft-deleted) key still names its rows", async () => {
  const [key] = mdb.rows("ApiKey");
  expect(key?.["id"]).toBe(KEY_ID);
  mdb.reset();
  // Rebuild the world with the key revoked.
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("ApiKey", { id: KEY_ID, tenantId: fx.tenantA.id, name: "LIMS integration", keyPrefix: "cbk_1a2b3c", keyHash: HASH, scopes: [], isActive: false, isDeleted: true });
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: fx.tenantA.id, name: "Infusion pump", serialNumber: "SN-R51" });
  mdb.seed("CalibrationRecord", { id: BY_KEY, tenantId: fx.tenantA.id, deviceId: DEVICE, performedBy: null, apiKeyId: KEY_ID, calibrationDate: new Date("2026-09-02") });

  as(admin);
  const res = await call(records, "GET", `/${BY_KEY}`);
  expect(res.status).toBe(200);
  const body = (res.body as { data: RecordBody }).data;
  expect(body.apiKey).toEqual({ id: KEY_ID, name: "LIMS integration", keyPrefix: "cbk_1a2b3c" });
  expect(JSON.stringify(res.body)).not.toContain(HASH);
});
