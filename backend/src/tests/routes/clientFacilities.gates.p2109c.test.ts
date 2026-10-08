/**
 * P21-09c — the client-facility routes' gates on the SEEDED matrix (P20-06's grants, spec
 * MEMORY/specs/P18-01-02 § 3.1; P19-04 § 13.1): the real seed into memoryDb read by the real
 * roles.service (fixtures/seededMatrix) — no menu granted by hand.
 *
 * - `GET /options` is any-of `calibration` / `ipm` / `client-facilities` read: a TECHNICIAN (no
 *   `client-facilities`) reads the picker, but not the administration list;
 * - ENGINEERING MANAGER holds `client-facilities` read: lists, cannot create;
 * - HEALTHCARE ADMIN and CALIBRATOR ADMIN hold write: create;
 * - DELETE is a tenant administrator's (rbac) — a TECHNICIAN is refused before the menu gate.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/clientFacilities.route";
import { seedRealMatrix, withSeededRole } from "../fixtures/seededMatrix";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/clientFacilities.route");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F_EMPTY = "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4";

const principals: Record<string, Principal> = {};
const BODY = { name: "Facility Seven", code: "F-0007" };

beforeEach(async () => {
  mdb.reset();
  const fx = twoTenants();
  for (const key of ["TECHNICIAN", "HEALTHCARE_TECHNICIAN", "ENGINEERING_MANAGER", "HEALTCARE_ADMIN", "CALIBRATOR_ADMIN", "SUPERVISOR"]) {
    principals[key] = withSeededRole(fx.principal(fx.tenantA, key));
  }
  seedTenants(mdb, fx, Object.values(principals));
  await seedRealMatrix(mdb);
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: fx.tenantA.id, name: "Facility One", code: "F-0001", status: "active" },
    { id: F_EMPTY, tenantId: fx.tenantA.id, name: "Created By Mistake", code: "F-0004", status: "active" },
  ]);
});

const status = async (key: string, method: string, path: string, body: unknown = {}): Promise<number> => {
  as(principals[key] as Principal);
  return (await call(router, method, path, { body })).status;
};

describe("P21-09c gates on the seeded matrix", () => {
  it.each(["TECHNICIAN", "HEALTHCARE_TECHNICIAN", "ENGINEERING_MANAGER", "HEALTCARE_ADMIN", "SUPERVISOR"])("%s reads GET /options (any-of calibration / ipm / client-facilities)", async (key) => {
    expect(await status(key, "GET", "/options")).toBe(200);
  });

  it.each(["TECHNICIAN", "HEALTHCARE_TECHNICIAN", "SUPERVISOR"])("%s is refused the administration list and a facility (403)", async (key) => {
    expect(await status(key, "GET", "/")).toBe(403);
    expect(await status(key, "GET", `/${F1}`)).toBe(403);
  });

  it("ENGINEERING MANAGER lists and reads (200) but cannot create (403)", async () => {
    expect(await status("ENGINEERING_MANAGER", "GET", "/")).toBe(200);
    expect(await status("ENGINEERING_MANAGER", "GET", `/${F1}`)).toBe(200);
    expect(await status("ENGINEERING_MANAGER", "POST", "/", BODY)).toBe(403);
  });

  it.each(["HEALTCARE_ADMIN", "CALIBRATOR_ADMIN"])("%s creates a facility (201)", async (key) => {
    expect(await status(key, "POST", "/", BODY)).toBe(201);
  });

  it("DELETE: a TECHNICIAN is refused by rbac (403); the tenant administrator deletes an unreferenced facility (200)", async () => {
    expect(await status("TECHNICIAN", "DELETE", `/${F_EMPTY}`)).toBe(403);
    expect(await status("HEALTCARE_ADMIN", "DELETE", `/${F_EMPTY}`)).toBe(200);
  });
});
