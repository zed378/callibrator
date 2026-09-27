/**
 * Two tenants — every /custom-domains/domains/:domainId route (CLAUDE.md:
 * "Every new :id route needs a two-tenant test asserting 404").
 *
 * REAL router, denyApiKey, dynamicAccess (role matrix granted),
 * validateUuid, controller, customDomains service and audit service on the
 * REAL models and tenant hooks (fixtures/memoryDb). Doubled: DNS resolution
 * (the TXT lookup answers "not found"). The feature is switched ON — with it
 * off, verify answers `{ verified: false }` before any lookup, for every id.
 *
 * @two-tenant api/customDomains.route.js POST /domains/:domainId/verify
 * @two-tenant api/customDomains.route.js DELETE /domains/:domainId
 * @two-tenant api/customDomains.route.js GET /domains/:domainId/status
 * @two-tenant api/customDomains.route.js POST /domains/:domainId/default
 * @two-tenant api/customDomains.route.js GET /domains/:domainId/dns
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const dns = require("dns");
const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/customDomains.route");

const DOMAIN_A = "a1000000-0000-4000-8000-000000000001";
const ctx = {};
const previousFlag = process.env.CUSTOM_DOMAINS_ENABLED;

beforeAll(() => {
  process.env.CUSTOM_DOMAINS_ENABLED = "true";
});
afterAll(() => {
  if (previousFlag === undefined) {
    delete process.env.CUSTOM_DOMAINS_ENABLED;
  } else {
    process.env.CUSTOM_DOMAINS_ENABLED = previousFlag;
  }
});

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  jest.spyOn(dns.promises, "resolveTxt").mockRejectedValue(Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" }));
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CustomDomain", {
    id: DOMAIN_A,
    tenantId: fx.tenantA.id,
    domain: "calibration.hospital-a.example.com",
    domainType: "custom",
    status: "pending_verification",
    isDefault: false,
    sslEnabled: false,
    verificationToken: "callibrator-verify=abc",
  });
});

const route = (key, method, path, extra = {}) => ({ key, method, path, id: () => DOMAIN_A, ...extra });

twoTenantSuite({
  module: "custom-domains",
  router,
  mdb,
  context: () => ctx,
  routes: [
    route("POST /domains/:domainId/verify", "POST", (id) => `/domains/${id}/verify`, { writes: ["CustomDomain", "AuditLog"] }),
    route("DELETE /domains/:domainId", "DELETE", (id) => `/domains/${id}`, { writes: ["CustomDomain", "AuditLog"] }),
    route("GET /domains/:domainId/status", "GET", (id) => `/domains/${id}/status`),
    route("POST /domains/:domainId/default", "POST", (id) => `/domains/${id}/default`, { writes: ["CustomDomain", "AuditLog"] }),
    route("GET /domains/:domainId/dns", "GET", (id) => `/domains/${id}/dns`),
  ],
});
