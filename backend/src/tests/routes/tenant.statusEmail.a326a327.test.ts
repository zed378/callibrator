/**
 * A-326 / A-327 (ADR-112) — a tenant edit that carries a status or clears the
 * email answers 200, 400 or 409, never a 500, and never writes a value the
 * column refuses.
 *
 * A-326: the validator upper-cases `status` (ACTIVE / INACTIVE / SUSPENDED) and
 * `tenants.status` is the lower-case ENUM (active / suspended / deleted), so
 * every edit that carried a status — the edit modal ALWAYS resubmits it — wrote
 * a value PostgreSQL refuses (measured on PG18.6: `invalid input value for enum`,
 * a 500). ADR-112: an edit does not change a tenant's status. The current
 * status resubmitted (any case) is no change; a different one is a 409 that
 * names the lifecycle endpoints, which write the suspension marks (ADR-094);
 * `INACTIVE`, which the ENUM has no value for, is a 400.
 *
 * A-327: `email: null` or `""` reached the NOT NULL, isEmail column (a 500); it
 * is now a 400 before anything is written.
 *
 * Fail-before is asserted on the write itself: memoryDb, unlike PostgreSQL,
 * stores an off-ENUM value, so the test checks every committed Tenant write
 * against the model's own ENUM values.
 *
 * REAL router, dynamicAccess, controller, tenant service and audit service on
 * the REAL models (fixtures/memoryDb). Doubled as in tenant.profile.a303.
 */
import type { RequestHandler } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as UploadUtil from "../../utils/upload.util";
import type * as RouteModule from "../../routes/api/tenant.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));
jest.mock("../../utils/upload.util", () => ({
  ...jest.requireActual<typeof UploadUtil>("../../utils/upload.util"),
  upload: (): RequestHandler => (_req, _res, next) => {
    next();
  },
  deleteUpload: () => Promise.resolve(),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenant.route");

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real models, after the jest.mock factories above
const models = require("../../models") as { Tenant: { rawAttributes: Record<string, { values?: readonly string[] }> } };

let tenantA = "";
let admin: Principal;
let superAdmin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  superAdmin = fx.superAdmin;
  // The shared fixture seeds "ACTIVE"; PostgreSQL holds the ENUM's "active".
  seedTenants(mdb, fx, [admin, superAdmin], { a: { status: "active" } });
});

const ENUM = (): readonly string[] => models.Tenant.rawAttributes["status"]?.values ?? [];

const tenantWrites = (): Record<string, unknown>[] =>
  mdb
    .committed()
    .filter((w) => w.model === "Tenant")
    .map((w) => (w.values ?? {}) as Record<string, unknown>);

const storedEmail = (): unknown => mdb.rows("Tenant").find((t) => t["id"] === tenantA)?.["email"];

const edit = (body: Record<string, unknown>): ReturnType<typeof call> =>
  call(router, "PATCH", "/edit", { body: { tenantId: tenantA, ...body }, baseUrl: "/api/v1/tenants" });

describe("A-326: an edit never writes a status outside the tenants.status ENUM", () => {
  it.each([["active"], ["ACTIVE"]])("a tenant admin resubmitting the current status (%s) saves, and writes no status", async (status) => {
    as(admin);
    const res = await edit({ name: "Renamed Lab", status });
    expect(res.status).toBe(200);
    const writes = tenantWrites();
    expect(writes.length).toBeGreaterThan(0);
    for (const values of writes) {
      if ("status" in values) {
        expect(ENUM()).toContain(values["status"]);
      }
    }
  });

  it("a super admin sending a DIFFERENT status gets a 409 naming the lifecycle, and nothing is written", async () => {
    as(superAdmin);
    const res = await edit({ status: "SUSPENDED" });
    expect(res.status).toBe(409);
    expect(String((res.body as { message?: string }).message)).toMatch(/lifecycle/i);
    expect(tenantWrites()).toEqual([]);
  });

  it("INACTIVE, which the ENUM has no value for, is a 400", async () => {
    as(superAdmin);
    const res = await edit({ status: "INACTIVE" });
    expect(res.status).toBe(400);
    expect(tenantWrites()).toEqual([]);
  });

  it("a tenant admin sending a different status is still refused 403 (A-63)", async () => {
    as(admin);
    const res = await edit({ status: "SUSPENDED" });
    expect(res.status).toBe(403);
  });

  it("control: an empty status is no change", async () => {
    as(admin);
    const res = await edit({ name: "Renamed Lab", status: "" });
    expect(res.status).toBe(200);
  });
});

describe("A-327: clearing a tenant's email is a 400, not a 500", () => {
  it.each([[null], [""]])("email %p answers 400 and the email is unchanged", async (email) => {
    as(admin);
    const before = storedEmail();
    const res = await edit({ email });
    expect(res.status).toBe(400);
    expect(storedEmail()).toBe(before);
  });

  it("control: a new valid email is stored", async () => {
    as(admin);
    const res = await edit({ email: "lab@example.id" });
    expect(res.status).toBe(200);
    expect(storedEmail()).toBe("lab@example.id");
  });
});
