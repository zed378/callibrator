/**
 * A-330 — the vendor search matches regardless of case (A-320, one more site).
 *
 * `vendor.service#fetchVendors` matched `find` with `Op.like`, case-sensitive on
 * PostgreSQL: "Acme Labs" was not found by typing "acme". It now uses
 * `Op.iLike` on the term as typed. A leading `%` rules out a b-tree index
 * either way.
 *
 * REAL router, controller, service and models on memoryDb, whose query double
 * evaluates `Op.like` case-sensitively and `Op.iLike` case-insensitively, as
 * PostgreSQL does.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as VendorRoute from "../../routes/api/vendor.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof VendorRoute>("../../routes/api/vendor.route");

/** The names a list answer carries in `data`. */
const names = (body: unknown): unknown[] => {
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data.map((row) => (row as Record<string, unknown>)["name"]) : [];
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Vendor", [
    { id: "a1000000-0000-4000-8000-000000000330", tenantId: fx.tenantA.id, name: "Acme Labs", type: "CalibrationLab" },
    { id: "a1000000-0000-4000-8000-000000000331", tenantId: fx.tenantA.id, name: "north supply", type: "PartsSupplier" },
  ]);
  as(admin);
});

describe("A-330 — vendor search is case-insensitive", () => {
  it.each([
    ["Acme", "Acme Labs"],
    ["acme", "Acme Labs"],
    ["ACME LABS", "Acme Labs"],
    ["North", "north supply"],
  ])("GET /?find=%s finds %s", async (find, name) => {
    const res = await call(router, "GET", "/", { query: { find } });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([name]);
  });

  it("control: a term that matches nothing finds nothing", async () => {
    const res = await call(router, "GET", "/", { query: { find: "zzz" } });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([]);
  });
});
