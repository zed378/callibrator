/**
 * Two tenants — every /scim/v2/Users/:id route (CLAUDE.md: "Every new :id
 * route needs a two-tenant test asserting 404"). The Groups routes are
 * covered by scim.groups.tenantOwned.a38.test.js; scim.crossTenantOracle.a37
 * probes a rename, this every verb.
 *
 * The principal is what auth.middleware#tryApiKeyAuth builds for an API key:
 * tenant B's key, scoped scim:read and scim:write, naming a user of tenant A.
 * The owner is tenant A's key.
 *
 * REAL router (scimAuthShim, requireApiKeyOrAdmin), controller, scim service
 * on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/scim.route.js GET /Users/:id
 * @two-tenant api/scim.route.js PUT /Users/:id
 * @two-tenant api/scim.route.js PATCH /Users/:id
 * @two-tenant api/scim.route.js DELETE /Users/:id
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TenantRow } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/scim.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/scim.route");

/** The synthetic principal auth.middleware#tryApiKeyAuth builds for a key. */
const apiKeyPrincipal = (keyId: string, tenant: TenantRow): Principal => ({
  id: keyId,
  username: "scim-connector",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: ["scim:read", "scim:write"],
});

let target = "";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  const fx = twoTenants();
  ctx = {
    owner: apiKeyPrincipal("ab000000-0000-4000-8000-000000000001", fx.tenantA),
    other: apiKeyPrincipal("ba000000-0000-4000-8000-000000000001", fx.tenantB),
  };
  const member = fx.principal(fx.tenantA, "USER");
  target = member.id;
  seedTenants(mdb, fx, [member]);
});

const USER_BODY = { userName: "nurse.a@hospital-a.example.com", name: { givenName: "Ana" } };

twoTenantSuite({
  module: "scim",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /Users/:id", method: "GET", path: (id) => `/Users/${id}`, id: () => target },
    { key: "PUT /Users/:id", method: "PUT", path: (id) => `/Users/${id}`, id: () => target, body: USER_BODY, writes: ["User"] },
    {
      key: "PATCH /Users/:id",
      method: "PATCH",
      path: (id) => `/Users/${id}`,
      id: () => target,
      body: { Operations: [{ op: "replace", path: "active", value: false }] },
      writes: ["User"],
    },
    { key: "DELETE /Users/:id", method: "DELETE", path: (id) => `/Users/${id}`, id: () => target, writes: ["User"] },
  ],
});
