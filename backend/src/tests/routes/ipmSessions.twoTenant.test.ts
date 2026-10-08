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
 *
 * P21-04 (A-10, A-11): the submit, the void, the report document and the signature.
 *
 * @two-tenant api/ipmSessions.route.ts POST /:sessionId/submit
 * @two-tenant api/ipmSessions.route.ts POST /:sessionId/void
 * @two-tenant api/ipmSessions.route.ts GET /:sessionId/report-document
 * @two-tenant api/ipmSessions.route.ts POST /:sessionId/signatures
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { IPM_RESULTS, answerAdvisoryLocks } from "../fixtures/ipmIssue";
import type CertificateServiceModule from "../../services/certificate.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const certificateService = jest.requireActual<typeof CertificateServiceModule>("../../services/certificate.service");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");

let ctx: SuiteContext;
let world: IpmWorld;
let fx: TwoTenantWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  world = seedIpmWorld(mdb, fx, seedTenants);
  ctx = { owner: world.staff, other: world.other };
  answerAdvisoryLocks(mdb);
  jest.spyOn(certificateService, "verifySignerCredentials").mockResolvedValue(undefined);
});

/** P21-04: staff's F2 draft (DRAFT2) complete at revision 2 — and submitted when `submit`. */
const prepare = (submit: boolean) => async (): Promise<void> => {
  const steps: [string, string, unknown][] = [
    ["PATCH", `/${IPM.DRAFT2}`, { revision: 0, inspectionOutcome: "pass", maintenanceOutcome: "pass", recommendation: "fit_for_use" }],
    ["PUT", `/${IPM.DRAFT2}/results`, { revision: 1, results: IPM_RESULTS }],
  ];
  if (submit) {
    steps.push(["POST", `/${IPM.DRAFT2}/submit`, { revision: 2 }]);
  }
  for (const [method, url, body] of steps) {
    as(world.staff);
    const res = await call(sessions, method, url, { body, routeFile: "api/ipmSessions.route.ts" });
    if (res.status !== 200) {
      throw new Error(`prepare: ${method} ${url} answered ${String(res.status)}`);
    }
  }
};
const tenantAdminOf = (tenant: "A" | "B"): Principal => fx.principal(tenant === "A" ? fx.tenantA : fx.tenantB, "TENANT_ADMIN");

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
    {
      key: "POST /:sessionId/submit",
      method: "POST",
      path: (id) => `/${id}/submit`,
      id: () => IPM.DRAFT2,
      before: prepare(false),
      body: { revision: 2 },
      writes: ["InspectionSession", "MaintenanceWorkOrder", "AuditLog"],
    },
    {
      key: "POST /:sessionId/void",
      method: "POST",
      path: (id) => `/${id}/void`,
      id: () => IPM.S1,
      principal: () => tenantAdminOf("B"),
      ownerPrincipal: () => tenantAdminOf("A"),
      body: { reason: "Synthetic duplicate visit" },
      writes: ["InspectionSession", "AuditLog"],
    },
    {
      key: "GET /:sessionId/report-document",
      method: "GET",
      path: (id) => `/${id}/report-document`,
      id: () => IPM.DRAFT2,
      before: prepare(true),
    },
    {
      key: "POST /:sessionId/signatures",
      method: "POST",
      path: (id) => `/${id}/signatures`,
      id: () => IPM.DRAFT2,
      before: prepare(true),
      body: { kind: "performer", authMethod: "password", authPayload: "synthetic-secret", meaningAcknowledged: true },
      ownerStatus: 201,
      writes: ["InspectionSessionSignature", "AuditLog"],
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
