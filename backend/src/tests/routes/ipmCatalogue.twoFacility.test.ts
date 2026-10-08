/**
 * P21-01 — the inspection catalogue and a facility-BOUND principal (spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 8.1, § 9, § 13; ADR-124 § 5 – § 7, ADR-125 § 6).
 *
 * The catalogue is GLOBAL: its reads are marked facility-accessible (constants/facilityAccess) and
 * a bound principal reads exactly what an unbound one reads — the same rows, the same ETag. There
 * is no facility-owned row to probe, so the two-facility question here is "nothing narrower,
 * nothing wider": a draft's id is the same 404 for a bound reader as a missing id. The proposals
 * are provider business: 403 FACILITY_ROUTE_REFUSED at the route, and DENY in the hooks (zero
 * rows from the model in a bound context). The operator routes are 403.
 *
 * @two-facility api/deviceTypes.route.ts GET /:deviceTypeId
 * @two-facility api/ipm.route.ts GET /template-versions/:versionId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as TypesRoute from "../../routes/api/deviceTypes.route";
import type * as IpmRoute from "../../routes/api/ipm.route";
import type * as ModelsModule from "../../models";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import { BASE_TEMPLATE, BASE_V1, seedCatalogue, seedType } from "../fixtures/catalogueSeed";
import type { ClientFacilityId, TenantId } from "../../types/ids";

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
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const typesRouter = jest.requireActual<typeof TypesRoute>("../../routes/api/deviceTypes.route");
const ipmRouter = jest.requireActual<typeof IpmRoute>("../../routes/api/ipm.route");
const models = jest.requireActual<typeof ModelsModule>("../../models");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BOUND_USER = "cccccccc-0000-4000-8000-0000000000f1";
const TYPE_A = "a1a1a1a1-0000-4000-8000-000000000001";
const DRAFT = "dfdfdfdf-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let bound: Principal;
let unbound: Principal;
let tenantA: string;

interface Res {
  status: number;
  body: { data?: unknown; code?: string; message?: string };
  headers: Record<string, unknown>;
}
const req = async (router: unknown, base: string, file: string, who: Principal, method: string, path: string, body: unknown = {}): Promise<Res> => {
  as(who);
  return (await call(router, method, path, { body, baseUrl: base, routeFile: file })) as unknown as Res;
};
const types = (who: Principal, method: string, path: string): Promise<Res> => req(typesRouter, "/api/v1/device-types", "api/deviceTypes.route.ts", who, method, path);
const ipm = (who: Principal, method: string, path: string, body?: unknown): Promise<Res> => req(ipmRouter, "/api/v1/ipm", "api/ipm.route.ts", who, method, path, body);

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  unbound = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  bound = { ...unbound, id: BOUND_USER, clientFacilityId: F1 } as unknown as Principal;
  seedTenants(mdb, fx, [unbound]);
  mdb.seed("ClientFacility", { id: F1, tenantId: tenantA, name: "Facility One", code: "F-0001", status: "active" });
  mdb.seed("User", {
    id: BOUND_USER,
    tenantId: tenantA,
    username: "boundf1",
    email: "boundf1@example.test",
    password: "not-a-hash",
    roleId: unbound.role.id,
    clientFacilityId: F1,
    status: "ACTIVE",
    isActive: true,
  });
  seedCatalogue(mdb);
  seedType(mdb, TYPE_A, "Test Device Type A");
  mdb.seed("InspectionTemplateVersion", { id: DRAFT, templateId: BASE_TEMPLATE, status: "draft", revision: 0 });
  mdb.seed("InspectionTemplateProposal", {
    id: "9a9a0000-0000-4000-8000-00000000000a",
    tenantId: tenantA,
    kind: "add_items",
    deviceTypeId: TYPE_A,
    proposedItems: [],
    reason: "Synthetic reason",
    status: "submitted",
    submittedBy: unbound.id,
  });
});

describe("a bound principal reads the global catalogue exactly as an unbound one", () => {
  it("device types: the list and one type by id (200, the same body)", async () => {
    expect((await types(bound, "GET", "/")).body).toEqual((await types(unbound, "GET", "/")).body);
    const one = await types(bound, "GET", `/${TYPE_A}`);
    expect(one.status).toBe(200);
    expect(one.body).toEqual((await types(unbound, "GET", `/${TYPE_A}`)).body);
  });

  it("the published document: 200 with the same ETag", async () => {
    const mine = await ipm(bound, "GET", "/templates/published");
    expect(mine.status).toBe(200);
    expect(mine.headers["etag"]).toBe((await ipm(unbound, "GET", "/templates/published")).headers["etag"]);
  });

  it("a version by id: a published one is 200; a draft is the 404 a missing id is", async () => {
    expect((await ipm(bound, "GET", `/template-versions/${BASE_V1}`)).status).toBe(200);
    const draft = await ipm(bound, "GET", `/template-versions/${DRAFT}`);
    expect(draft.status).toBe(404);
    expect(draft.body).toEqual((await ipm(bound, "GET", `/template-versions/${MISSING}`)).body);
  });
});

describe("what a bound principal is refused", () => {
  it("the proposals (403 FACILITY_ROUTE_REFUSED at the route) and the operator routes (403)", async () => {
    for (const [method, path] of [
      ["GET", "/template-proposals"],
      ["POST", "/template-proposals"],
      ["GET", "/template-proposals/9a9a0000-0000-4000-8000-00000000000a"],
      ["GET", "/templates"],
      ["GET", "/item-definitions"],
    ] as const) {
      const res = await ipm(bound, method, path, {});
      expect({ path, status: res.status, code: res.body.code }).toEqual({ path, status: 403, code: "FACILITY_ROUTE_REFUSED" });
    }
  });

  it("and the hooks DENY the proposal model in a bound context (zero rows), while the global models read", async () => {
    const context = {
      tenantId: tenantA as TenantId,
      isSuperAdmin: false,
      isSystemTask: false,
      userId: BOUND_USER,
      clientFacilityId: F1 as ClientFacilityId,
      facilityBound: true,
    };
    const [proposals, typesRead] = await tenantStorage.run(context, async () =>
      Promise.all([models.InspectionTemplateProposal.count(), models.DeviceType.count()]),
    );
    expect(proposals).toBe(0);
    expect(typesRead).toBe(1);
    expect(await tenantStorage.run({ ...context, facilityBound: false, clientFacilityId: null }, () => models.InspectionTemplateProposal.count())).toBe(1);
  });
});
