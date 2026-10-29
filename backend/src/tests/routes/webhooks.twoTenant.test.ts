/**
 * Two tenants — every /webhooks/:id route (CLAUDE.md: "Every new :id route
 * needs a two-tenant test asserting 404").
 *
 * REAL router, denyApiKey, rbac, validateUuid, validate, controller and
 * webhook service on the REAL models and tenant hooks (fixtures/memoryDb).
 * Doubled: the outbound HTTP (global fetch) and the webhook service's one raw
 * SQL statement, the delivery claim (answered by `onQuery`, which asserts the
 * claim carries the caller's tenant — raw SQL bypasses the hooks).
 *
 * @two-tenant api/webhooks.route.ts GET /:id
 * @two-tenant api/webhooks.route.ts PATCH /:id
 * @two-tenant api/webhooks.route.ts DELETE /:id
 * @two-tenant api/webhooks.route.ts GET /:id/deliveries
 * @two-tenant api/webhooks.route.ts POST /:id/test
 * @two-tenant api/webhooks.route.ts POST /:id/rotate-secret
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/webhooks.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/webhooks.route");

const HOOK_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Webhook", {
    id: HOOK_A,
    tenantId: fx.tenantA.id,
    url: "https://receiver.hospital-a.example.com/hook",
    events: ["certificate.signed"],
    secret: "sealed-secret",
    isActive: true,
    createdBy: ctx.owner.id,
  });
  // The claim is the only raw SQL on these paths. It must name the tenant.
  mdb.onQuery((sql: string, options: { bind?: unknown }) => {
    // P9-18: the claim is sent through sql() — the tenant is bound as $4.
    expect(sql).toContain("tenant_id = $4");
    expect((options.bind as unknown[] | undefined)?.[3]).toBe(fx.tenantA.id);
    return []; // nothing claimed: the test delivery stays pending
  });
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response);
});

interface WebhookRouteExtra {
    readonly body?: unknown;
    readonly writes?: readonly string[];
}

const route = (key: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: (id: string) => string, extra: WebhookRouteExtra = {}) => ({
  key,
  method,
  path,
  id: () => HOOK_A,
  ...extra,
});

twoTenantSuite({
  module: "webhooks",
  router,
  mdb,
  context: () => ctx,
  routes: [
    route("GET /:id", "GET", (id) => `/${id}`),
    route("PATCH /:id", "PATCH", (id) => `/${id}`, { body: { description: "Renamed" }, writes: ["Webhook"] }),
    route("DELETE /:id", "DELETE", (id) => `/${id}`, { writes: ["Webhook"] }),
    route("GET /:id/deliveries", "GET", (id) => `/${id}/deliveries`),
    route("POST /:id/test", "POST", (id) => `/${id}/test`, { writes: ["WebhookDelivery"] }),
    route("POST /:id/rotate-secret", "POST", (id) => `/${id}/rotate-secret`, { writes: ["Webhook", "AuditLog"] }),
  ],
});
