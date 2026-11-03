/**
 * Two tenants — the `:userId` route of personal e-signatures (CLAUDE.md: "Every new :id route needs
 * a two-tenant test asserting 404"). P21-15 (ADR-140).
 *
 * REAL router, validateUuid, rbac, dynamicAccess (role matrix granted), denyPlatformAuthoring,
 * controller, service and audit service on the REAL models and tenant hooks (fixtures/memoryDb). The
 * user is read through the tenant hook, which is what keeps tenant B's administrator out.
 *
 * @two-tenant api/userEsignatures.route.ts POST /users/:userId/revoke
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/userEsignatures.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/userEsignatures.route");

let ctx: SuiteContext & { readonly signer: string };

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const signer = fx.principal(fx.tenantA, "TECHNICIAN");
  ctx = { owner: fx.principal(fx.tenantA, "TENANT_ADMIN"), other: fx.principal(fx.tenantB, "TENANT_ADMIN"), signer: signer.id };
  seedTenants(mdb, fx, [ctx.owner, ctx.other, signer]);
  mdb.seed("UserEsignature", {
    id: "a5000000-0000-4000-8000-000000000001",
    tenantId: fx.tenantA.id,
    userId: signer.id,
    version: 1,
    specimenSvg: "<svg></svg>",
    publicKeyPem: "synthetic-public-key",
    privateKeyEnc: "synthetic-envelope",
    keyFingerprint: "f".repeat(64),
    status: "active",
  });
});

twoTenantSuite({
  module: "esignature",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "POST /users/:userId/revoke",
      method: "POST",
      path: (id) => `/users/${id}/revoke`,
      id: (c) => c.signer,
      body: { reason: "Departed employee" },
      writes: ["UserEsignature", "AuditLog"],
    },
  ],
});
