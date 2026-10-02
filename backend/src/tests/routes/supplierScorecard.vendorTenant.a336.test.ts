/**
 * A-336 (2026-10-01) — a supplier scorecard names only a vendor of the
 * caller's tenant, and its body is an allow-list.
 *
 * `POST /api/v1/supplier-scorecard` checked the vendor's tenant; `PUT /:id`
 * did not, so an update could re-point a scorecard to ANOTHER tenant's vendor.
 * Neither write mounted `validate()`: a score of 101, a status outside the
 * vocabulary and a rewritten `evaluatedBy` were stored. Fail-before: against
 * the route without the schemas and the service without the update check, the
 * other tenant's vendor was stored (200) and every bound was accepted.
 *
 * Another tenant's vendor answers exactly what a vendor that does not exist
 * answers: 404, same message — never 403 (the tenant-membership oracle).
 *
 * @two-tenant api/supplierScorecard.route.ts PUT /:id
 *
 * REAL router, dynamicAccess (matrix granted), validate, controller, service,
 * audit, models and tenant hooks over memoryDb.
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

const VENDOR_A = "a3360000-0000-4000-8000-00000000000a";
const VENDOR_A2 = "a3360000-0000-4000-8000-0000000000a2";
const VENDOR_B = "a3360000-0000-4000-8000-00000000000b";
const MISSING = "a3360000-0000-4000-8000-0000000000ee";
const SCORECARD = "a3360000-0000-4000-8000-000000000001";
const OTHER_USER = "a3360000-0000-4000-8000-000000000099";

let fx: ReturnType<typeof twoTenants>;
let admin: ReturnType<ReturnType<typeof twoTenants>["principal"]>;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: fx.tenantA.id, name: "Lab A", type: "CalibrationLab", status: "Active" });
  mdb.seed("Vendor", { id: VENDOR_A2, tenantId: fx.tenantA.id, name: "Lab A2", type: "CalibrationLab", status: "Active" });
  mdb.seed("Vendor", { id: VENDOR_B, tenantId: fx.tenantB.id, name: "Lab B", type: "CalibrationLab", status: "Active" });
  mdb.seed("SupplierScorecard", {
    id: SCORECARD, tenantId: fx.tenantA.id, vendorId: VENDOR_A, evaluationDate: "2026-09-01T00:00:00.000Z",
    qualityScore: 80, deliveryScore: 80, serviceScore: 80, status: "APPROVED", evaluatedBy: admin.id,
  });
  as(admin);
});

type Row = Record<string, unknown>;
const scorecards = (): Row[] => mdb.rows("SupplierScorecard");
const stored = (id: string): Row | undefined => scorecards().find((row) => row["id"] === id);
const answer = (res: { status: number; body: unknown }) => ({ status: res.status, message: (res.body as { message?: unknown }).message });

describe("A-336 — a scorecard's vendor is the caller's tenant's", () => {
  it("PUT to another tenant's vendor answers exactly what a missing vendor answers (404), and changes nothing", async () => {
    const before = JSON.stringify(stored(SCORECARD));
    const crossTenant = await call(router, "PUT", `/${SCORECARD}`, { body: { vendorId: VENDOR_B } });
    const missing = await call(router, "PUT", `/${SCORECARD}`, { body: { vendorId: MISSING } });
    expect(answer(crossTenant)).toEqual({ status: 404, message: "Vendor not found" });
    expect(answer(crossTenant)).toEqual(answer(missing));
    expect(JSON.stringify(stored(SCORECARD))).toBe(before);
  });

  it("POST naming another tenant's vendor is the same 404 as a missing one", async () => {
    const body = { evaluationDate: "2026-09-30", qualityScore: 90 };
    const crossTenant = await call(router, "POST", "/", { body: { ...body, vendorId: VENDOR_B } });
    const missing = await call(router, "POST", "/", { body: { ...body, vendorId: MISSING } });
    expect(answer(crossTenant)).toEqual({ status: 404, message: "Vendor not found" });
    expect(answer(crossTenant)).toEqual(answer(missing));
    expect(scorecards()).toHaveLength(1);
  });

  it("PUT to another vendor of the same tenant is accepted", async () => {
    const res = await call(router, "PUT", `/${SCORECARD}`, { body: { vendorId: VENDOR_A2, status: "PROBATION" } });
    expect(res.status).toBe(200);
    expect(stored(SCORECARD)).toMatchObject({ vendorId: VENDOR_A2, status: "PROBATION" });
  });
});

describe("A-336 — a scorecard body carries only its allow-listed fields", () => {
  it("id, tenantId, evaluatedBy and overallScore in a body are ignored", async () => {
    const created = await call(router, "POST", "/", {
      body: {
        vendorId: VENDOR_A, evaluationDate: "2026-09-30", qualityScore: "90",
        id: MISSING, tenantId: fx.tenantB.id, evaluatedBy: OTHER_USER, overallScore: 1,
      },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { data: Row }).data["id"] as string;
    expect(id).not.toBe(MISSING);
    expect(stored(id)).toMatchObject({ tenantId: fx.tenantA.id, evaluatedBy: admin.id, qualityScore: 90 });

    const updated = await call(router, "PUT", `/${SCORECARD}`, { body: { comments: "Late twice", evaluatedBy: OTHER_USER, tenantId: fx.tenantB.id } });
    expect(updated.status).toBe(200);
    expect(stored(SCORECARD)).toMatchObject({ tenantId: fx.tenantA.id, evaluatedBy: admin.id, comments: "Late twice" });
  });

  it.each([
    ["POST", "/", { vendorId: VENDOR_A }, "evaluationDate"],
    ["POST", "/", { evaluationDate: "2026-09-30" }, "vendorId"],
    ["POST", "/", { vendorId: VENDOR_A, evaluationDate: "2026-09-30", qualityScore: 101 }, "qualityScore"],
    ["PUT", `/${SCORECARD}`, { deliveryScore: -1 }, "deliveryScore"],
    ["PUT", `/${SCORECARD}`, { status: "EXCELLENT" }, "status"],
    ["PUT", `/${SCORECARD}`, { vendorId: "not-a-uuid" }, "vendorId"],
  ] as const)("%s %s refuses %j with a 400 naming the field, and writes nothing", async (method, path, body, field) => {
    const before = JSON.stringify(scorecards());
    const res = await call(router, method, path, { body });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    expect(JSON.stringify(scorecards())).toBe(before);
  });
});
