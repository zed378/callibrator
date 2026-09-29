/**
 * Two tenants — DELETE /esignature/key-pairs/:keyPairId and PUT
 * /esignature/workflows/:workflowId (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404"). The other e-signature :id routes are
 * covered by eSignature.signer.a91.test.js and eSignature.a129a130.test.js.
 *
 * REAL router, denyApiKey, dynamicAccess (role matrix granted),
 * validateUuid, controller and eSignature service on the REAL models and
 * tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/eSignature.route.js DELETE /key-pairs/:keyPairId
 * @two-tenant api/eSignature.route.js PUT /workflows/:workflowId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/eSignature.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/eSignature.route");

const KEY_A = "a1000000-0000-4000-8000-000000000001";
const WORKFLOW_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("TenantKey", {
    id: KEY_A,
    tenantId: fx.tenantA.id,
    keyId: "key-a-1",
    keyType: "signing",
    algorithm: "RS256",
    publicKey: "-----BEGIN PUBLIC KEY-----",
    privateKey: "sealed",
  });
  mdb.seed("SignatureWorkflow", {
    id: WORKFLOW_A,
    tenantId: fx.tenantA.id,
    documentId: "a3000000-0000-4000-8000-000000000001",
    subject: "Sign the calibration report",
    status: "pending",
    signatureAlgorithm: "RS256",
    requestedBy: ctx.owner.id,
  });
});

twoTenantSuite({
  module: "esignature",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "DELETE /key-pairs/:keyPairId", method: "DELETE", path: (id) => `/key-pairs/${id}`, id: () => KEY_A, writes: ["TenantKey"] },
    {
      key: "PUT /workflows/:workflowId",
      method: "PUT",
      path: (id) => `/workflows/${id}`,
      id: () => WORKFLOW_A,
      body: { subject: "Sign the corrected report" },
      writes: ["SignatureWorkflow", "AuditLog"],
    },
  ],
});
