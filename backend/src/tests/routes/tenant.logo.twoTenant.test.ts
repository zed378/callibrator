/**
 * Two tenants — DELETE /tenants/:tenantId/logo (CLAUDE.md: "Every new :id
 * route needs a two-tenant test asserting 404"). POST is covered by
 * tenant.logo.a79.test.js.
 *
 * The probe is tenant B's ADMINISTRATOR (who holds management:update) naming
 * tenant A in the path — tenant A HAS a logo, so a refusal cannot hide behind
 * "nothing to remove". The owner is tenant A's administrator.
 *
 * REAL router, dynamicAccess (checkTenant real; role matrix granted),
 * controller, tenantUpload service and audit service on the REAL models and
 * tenant hooks (fixtures/memoryDb). Doubled: deleting the replaced logo FILE
 * (upload.util#deleteUpload).
 *
 * @two-tenant api/tenant.route.js DELETE /:tenantId/logo
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as UploadUtil from "../../utils/upload.util";
import type * as RouteModule from "../../routes/api/tenant.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../utils/upload.util", () => ({
  ...jest.requireActual<typeof UploadUtil>("../../utils/upload.util"),
  deleteUpload: () => Promise.resolve(),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenant.route");

let tenantA = "";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other], { a: { logo: "5d2b7e-logo.png" } });
});

twoTenantSuite({
  module: "tenants",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "DELETE /:tenantId/logo", method: "DELETE", path: (id) => `/${id}/logo`, id: () => tenantA, writes: ["Tenant", "AuditLog"] },
  ],
});
