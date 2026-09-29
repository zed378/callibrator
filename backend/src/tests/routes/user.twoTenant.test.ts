/**
 * Two tenants — PATCH /users/:userId/profile and DELETE /users/:userId/avatar
 * (CLAUDE.md: "Every new :id route needs a two-tenant test asserting 404").
 * user.profile.a63 has no cross-tenant case and user.avatar.a93 covers POST
 * avatar only; the three admin resets are covered by user.mfaReset.a141,
 * user.passkeyReset.a262 and user.passwordReset.a162.
 *
 * The probe is tenant B's ADMINISTRATOR (who holds users:update, so the gate's
 * permission check passes and only the tenant decides) naming a user of
 * tenant A. The owner is tenant A's administrator.
 *
 * REAL router, validateUuid, dynamicAccess (checkTenant and checkSelf real;
 * role matrix granted), controller, user service and audit service on the
 * REAL models and tenant hooks (fixtures/memoryDb). Doubled: deleting the
 * replaced avatar FILE (upload.util#deleteUpload).
 *
 * @two-tenant api/user.route.js PATCH /:userId/profile
 * @two-tenant api/user.route.js DELETE /:userId/avatar
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as UploadUtil from "../../utils/upload.util";
import type * as RouteModule from "../../routes/api/user.route";

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
const router = jest.requireActual<typeof RouteModule>("../../routes/api/user.route");

let target = "";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  const member = fx.principal(fx.tenantA, "USER");
  target = member.id;
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("User", {
    id: member.id,
    tenantId: member.tenantId,
    username: member.username,
    name: member.username,
    email: `${member.username}@hospital-a.test`,
    password: "not-a-hash",
    roleId: member.role.id,
    status: "ACTIVE",
    isActive: true,
    avatarUrl: "7c1e9f-avatar.png",
  });
});

twoTenantSuite({
  module: "users",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "PATCH /:userId/profile",
      method: "PATCH",
      path: (id) => `/${id}/profile`,
      id: () => target,
      body: { firstName: "Renamed" },
      writes: ["User", "AuditLog"],
    },
    {
      key: "DELETE /:userId/avatar",
      method: "DELETE",
      path: (id) => `/${id}/avatar`,
      id: () => target,
      writes: ["User", "AuditLog"],
    },
  ],
});
