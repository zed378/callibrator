/* eslint-disable no-restricted-properties -- test toggles CUSTOM_DOMAINS_ENABLED feature flag */
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

import dns from "dns";
import type { Router } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<Router>("../../routes/api/customDomains.route");

const DOMAIN_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;
const previousFlag = process.env["CUSTOM_DOMAINS_ENABLED"];

beforeAll(() => {
  process.env["CUSTOM_DOMAINS_ENABLED"] = "true";
});
afterAll(() => {
  if (previousFlag === undefined) {
    delete process.env["CUSTOM_DOMAINS_ENABLED"];
  } else {
    process.env["CUSTOM_DOMAINS_ENABLED"] = previousFlag;
  }
});

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  jest.spyOn(dns.promises, "resolveTxt").mockRejectedValue(Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" }));
  const fx = twoTenants();
  ctx = {
    owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"),
    other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN"),
  };
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

interface RouteExtra {
  writes?: string[];
}

const route = (key: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: (id: string) => string, extra: RouteExtra = {}) => ({
  key,
  method,
  path,
  id: () => DOMAIN_A,
  ...extra,
});

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
