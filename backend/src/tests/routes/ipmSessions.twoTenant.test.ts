/**
 * P21-03 — A-10 (P18-04 plan; spec P19-02 § 17): every `:sessionId` route of the IPM session
 * router, and the device's IPM history, answer another tenant's principal 404 — identical to a
 * missing id — and write nothing; the owning tenant reaches each one.
 *
 * REAL: the routers' chains (auth double → tenant context, dynamicAccess, denyApiKey,
 * denyPlatformAuthoring, validate, idempotency), the controller, the service, the models and the
 * tenant + facility hooks over memoryDb.
 *
 * @two-tenant api/ipmSessions.route.ts GET /:sessionId
 * @two-tenant api/ipmSessions.route.ts PATCH /:sessionId
 * @two-tenant api/ipmSessions.route.ts PUT /:sessionId/results
 * @two-tenant api/ipmSessions.route.ts POST /:sessionId/discard
 * @two-tenant api/ipmSessions.route.ts POST /:sessionId/corrections
 * @two-tenant api/calibrationDevices.route.ts GET /:calibrationDeviceId/ipm-sessions
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import { IPM, seedIpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");

let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  ctx = { owner: world.staff, other: world.other };
});

twoTenantSuite({
  module: "ipm-sessions",
  router: sessions,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:sessionId", method: "GET", path: (id) => `/${id}`, id: () => IPM.S1 },
    {
      key: "PATCH /:sessionId",
      method: "PATCH",
      path: (id) => `/${id}`,
      id: () => IPM.DRAFT2,
      body: { revision: 0, notes: "Synthetic note" },
      writes: ["InspectionSession", "AuditLog"],
    },
    {
      key: "PUT /:sessionId/results",
      method: "PUT",
      path: (id) => `/${id}/results`,
      id: () => IPM.DRAFT2,
      body: { revision: 0, results: [{ inputKind: "tri_state", templateItemId: IPM.ITEM_POWER, outcome: "pass" }] },
      writes: ["InspectionSession", "InspectionResult", "AuditLog"],
    },
    {
      key: "POST /:sessionId/discard",
      method: "POST",
      path: (id) => `/${id}/discard`,
      id: () => IPM.DRAFT2,
      body: {},
      writes: ["InspectionSession", "AuditLog"],
    },
    {
      key: "POST /:sessionId/corrections",
      method: "POST",
      path: (id) => `/${id}/corrections`,
      id: () => IPM.S1,
      body: { reason: "Synthetic correction" },
      ownerStatus: 201,
      writes: ["InspectionSession", "InspectionResult", "AuditLog"],
    },
  ],
});

twoTenantSuite({
  module: "calibration-devices",
  router: devices,
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /:calibrationDeviceId/ipm-sessions", method: "GET", path: (id) => `/${id}/ipm-sessions`, id: () => IPM.D1 }],
});
