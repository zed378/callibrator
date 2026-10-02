/**
 * A-346 (2026-10-02) — a malformed scorecard id is a 400, never a 500.
 *
 * `GET`, `PUT` and `DELETE /api/v1/supplier-scorecard/:id` had no
 * `validateUuid`, so a non-uuid id (the live E2E pair I/J sent `null`) went
 * straight to PostgreSQL's uuid cast and answered 500. Every sibling module
 * answers 400 "Invalid …: must be a valid UUID". Fail-before: against the
 * route without `validateUuid`, each malformed id below reached the handler
 * (the memory database answers it 404, PostgreSQL 500) instead of the 400.
 *
 * A well-formed id that does not exist is still the handler's 404, and an
 * existing one still answers 200 — the check refuses the shape only.
 *
 * REAL router, validateUuid, dynamicAccess (matrix granted), validate,
 * controller, service, models and tenant hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as ScorecardRoute from "../../routes/api/supplierScorecard.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof ScorecardRoute>("../../routes/api/supplierScorecard.route");

const VENDOR_A = "a3460000-0000-4000-8000-00000000000a";
const SCORECARD = "a3460000-0000-4000-8000-000000000001";
const MISSING = "a3460000-0000-4000-8000-0000000000ee";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: fx.tenantA.id, name: "Lab A", type: "CalibrationLab", status: "Active" });
  mdb.seed("SupplierScorecard", {
    id: SCORECARD, tenantId: fx.tenantA.id, vendorId: VENDOR_A, evaluationDate: "2026-09-01T00:00:00.000Z",
    qualityScore: 80, deliveryScore: 80, serviceScore: 80, status: "APPROVED", evaluatedBy: admin.id,
  });
  as(admin);
});

type Method = "GET" | "PUT" | "DELETE";
const METHODS: readonly Method[] = ["GET", "PUT", "DELETE"];
const bodyFor = (method: Method) => (method === "PUT" ? { body: { comments: "A-346" } } : {});
const snapshot = (): string => JSON.stringify(mdb.rows("SupplierScorecard"));

describe("A-346 — /supplier-scorecard/:id refuses a malformed id with a 400", () => {
  const malformed = ["null", "undefined", "not-a-uuid", "12345", `${SCORECARD}x`];

  for (const method of METHODS) {
    it.each(malformed)(`${method} /%s answers 400 "Invalid id: must be a valid UUID" and changes nothing`, async (id) => {
      const before = snapshot();
      const res = await call(router, method, `/${id}`, bodyFor(method));
      expect(res.status).toBe(400);
      const body = res.body as { success?: unknown; message?: unknown };
      expect(body.success).toBe(false);
      expect(String(body.message)).toMatch(/^Invalid id: must be a valid UUID/);
      expect(snapshot()).toBe(before);
    });
  }
});

describe("A-346 — a well-formed id still reaches the handler", () => {
  it.each(METHODS)("%s on a well-formed id that does not exist is the handler's 404", async (method) => {
    const before = snapshot();
    const res = await call(router, method, `/${MISSING}`, bodyFor(method));
    expect(res.status).toBe(404);
    expect(snapshot()).toBe(before);
  });

  it("GET on an existing scorecard is a 200", async () => {
    const res = await call(router, "GET", `/${SCORECARD}`);
    expect(res.status).toBe(200);
    expect((res.body as { data: { id: string } }).data.id).toBe(SCORECARD);
  });
});
