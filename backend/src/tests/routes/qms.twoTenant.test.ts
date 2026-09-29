/**
 * Two tenants — PATCH /qms/nc/:id and PATCH /qms/capa/:id (CLAUDE.md: "Every
 * new :id route needs a two-tenant test asserting 404"). qms.tenancy.a75
 * covers foreign REFERENCES inside the body; this covers a foreign record id.
 *
 * REAL router, denyApiKey, dynamicAccess (role matrix granted), validate,
 * controller, qms service and audit service on the REAL models and tenant
 * hooks (fixtures/memoryDb).
 *
 * TypeScript without jest's hoisting (jest.transform.js runs no hoist plugin):
 * the mocks are registered first, then every runtime module is loaded with
 * `jest.requireActual`, typed through an erased `import type`.
 *
 * @two-tenant api/qms.route.js PATCH /nc/:id
 * @two-tenant api/qms.route.js PATCH /capa/:id
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as QmsRoute from "../../routes/api/qms.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof QmsRoute>("../../routes/api/qms.route");

const NC_A = "a1000000-0000-4000-8000-000000000001";
const CAPA_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("NonConformance", {
    id: NC_A,
    tenantId: fx.tenantA.id,
    ncNumber: "NC-2026-0001",
    title: "Out-of-tolerance reading",
    description: "Pump A read 12% high",
    status: "OPEN",
    severity: "HIGH",
    reportedBy: ctx.owner.id,
    dateIdentified: new Date("2026-09-01"),
  });
  mdb.seed("Capa", {
    id: CAPA_A,
    tenantId: fx.tenantA.id,
    capaNumber: "CAPA-2026-0001",
    ncId: NC_A,
    title: "Recalibrate pump A",
    actionPlan: "Recalibrate and retrain",
    status: "OPEN",
  });
});

twoTenantSuite({
  module: "qms",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "PATCH /nc/:id",
      method: "PATCH",
      path: (id: string) => `/nc/${id}`,
      id: () => NC_A,
      body: { title: "Renamed" },
      writes: ["NonConformance", "AuditLog"],
    },
    {
      key: "PATCH /capa/:id",
      method: "PATCH",
      path: (id: string) => `/capa/${id}`,
      id: () => CAPA_A,
      body: { title: "Renamed" },
      writes: ["Capa", "AuditLog"],
    },
  ],
});
