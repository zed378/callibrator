/**
 * P21-09c — the client-facility administration routes (spec MEMORY/specs/P19-04-client-facilities.md
 * § 13.1, § 4.4 – § 4.6; ADR-124 Am. 2, Am. 5).
 *
 * REAL: the router and its gates (dynamicAccess with the role matrix granted, rbac, denyApiKey,
 * validate from params+body), the facility route gate inside tenantContextMiddleware, the
 * controller, services/clientFacilityAdmin, the session and audit services, the models and the
 * tenant + facility hooks over memoryDb. DOUBLED: the redis cache the session revocation clears.
 *
 * Two tenants (CLAUDE.md: every new `:id` route): another tenant's facility answers 404, exactly as
 * a missing one, and nothing is written (twoTenantSuite). Two facilities: every administration route is UNMARKED, so a
 * facility-bound principal is refused 403 `FACILITY_ROUTE_REFUSED` before a parameter is read —
 * identical for its own facility, another facility of its tenant and a missing id.
 *
 * @two-tenant api/clientFacilities.route.ts GET /:clientFacilityId
 * @two-tenant api/clientFacilities.route.ts PATCH /:clientFacilityId
 * @two-tenant api/clientFacilities.route.ts POST /:clientFacilityId/status
 * @two-tenant api/clientFacilities.route.ts DELETE /:clientFacilityId
 * @two-tenant api/clientFacilities.route.ts GET /:clientFacilityId/users
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/clientFacilities.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/clientFacilities.route");

const SELF_A = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const F_EMPTY = "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4";
const F_ENDED = "f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BOUND_USER = "cccccccc-0000-4000-8000-0000000000f1";
const ROUTE_FILE = "api/clientFacilities.route.ts";
const BASE = "/api/v1/client-facilities";

let ctx: SuiteContext;
let supervisor: Principal;
let boundAdmin: Principal;
let seeded = 0;
const testWrites = (): string[] => mdb.committed().slice(seeded).map((w) => w.model);

interface Body { data?: unknown; meta?: unknown; message?: string; code?: string }
const bodyOf = (res: { body: unknown }): Body => res.body as Body;
const req = (principal: Principal, method: string, path: string, body: unknown = {}, query: Record<string, unknown> = {}): ReturnType<typeof call> => {
  as(principal);
  return call(router, method, path, { body, query, baseUrl: BASE, routeFile: ROUTE_FILE });
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  supervisor = fx.principal(fx.tenantA, "SUPERVISOR");
  boundAdmin = { ...fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), id: BOUND_USER, clientFacilityId: F1 } as unknown as Principal;
  seedTenants(mdb, fx, [ctx.owner, ctx.other, supervisor]);
  mdb.seed("ClientFacility", [
    { id: SELF_A, tenantId: fx.tenantA.id, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: fx.tenantA.id, name: "Facility One", code: "F-0001", kind: "clinic", status: "active" },
    { id: F2, tenantId: fx.tenantA.id, name: "Facility Two", code: "F-0002", status: "active" },
    { id: F_EMPTY, tenantId: fx.tenantA.id, name: "Created By Mistake", code: "F-0004", status: "active" },
    { id: F_ENDED, tenantId: fx.tenantA.id, name: "Facility Ended", code: "F-0005", status: "ended", statusReason: "client left" },
  ]);
  mdb.seed("User", {
    id: BOUND_USER,
    tenantId: fx.tenantA.id,
    username: "boundf1",
    email: "boundf1@example.test",
    password: "not-a-hash",
    roleId: ctx.owner.role.id,
    clientFacilityId: F1,
    status: "ACTIVE",
    isActive: true,
  });
  mdb.seed("Session", [
    { id: "5e550000-0000-4000-8000-0000000000f1", user_id: BOUND_USER, tenant_id: fx.tenantA.id, token_hash: "h1", is_revoked: false, is_active: true },
  ]);
  seeded = mdb.committed().length;
});

twoTenantSuite({
  module: "client-facilities",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:clientFacilityId", method: "GET", path: (id) => `/${id}`, id: () => F1 },
    {
      key: "PATCH /:clientFacilityId",
      method: "PATCH",
      path: (id) => `/${id}`,
      id: () => F1,
      body: { name: "Facility One Renamed" },
      writes: ["ClientFacility", "AuditLog"],
    },
    {
      key: "POST /:clientFacilityId/status",
      method: "POST",
      path: (id) => `/${id}/status`,
      id: () => F2,
      body: { status: "inactive", reason: "Contract paused" },
      writes: ["ClientFacility", "AuditLog"],
    },
    { key: "DELETE /:clientFacilityId", method: "DELETE", path: (id) => `/${id}`, id: () => F_EMPTY, writes: ["ClientFacility", "AuditLog"] },
    { key: "GET /:clientFacilityId/users", method: "GET", path: (id) => `/${id}/users`, id: () => F1 },
  ],
});

describe("two facilities — the administration routes are unmarked (403 FACILITY_ROUTE_REFUSED for a bound principal)", () => {
  const ROUTES: readonly [string, string, (id: string) => string, unknown][] = [
    ["GET /", "GET", () => "/", {}],
    ["GET /options", "GET", () => "/options", {}],
    ["GET /:clientFacilityId", "GET", (id) => `/${id}`, {}],
    ["PATCH /:clientFacilityId", "PATCH", (id) => `/${id}`, { name: "Renamed" }],
    ["POST /:clientFacilityId/status", "POST", (id) => `/${id}/status`, { status: "inactive", reason: "Paused" }],
    ["DELETE /:clientFacilityId", "DELETE", (id) => `/${id}`, {}],
    ["GET /:clientFacilityId/users", "GET", (id) => `/${id}/users`, {}],
  ];

  it.each(ROUTES)("%s: own facility, another facility and a missing id answer the same 403, nothing written", async (_key, method, path, body) => {
    const answers = [];
    for (const id of [F1, F2, MISSING]) {
      const res = await req(boundAdmin, method, path(id), body);
      answers.push({ status: res.status, code: bodyOf(res).code, message: bodyOf(res).message });
    }
    expect(answers[0]).toEqual({ status: 403, code: "FACILITY_ROUTE_REFUSED", message: expect.any(String) as unknown });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(testWrites()).toEqual([]);
  });

  it("GET /mine stays reachable for the bound principal (the one marked route)", async () => {
    const res = await req(boundAdmin, "GET", "/mine");
    expect(res.status).toBe(200);
    expect((bodyOf(res).data as { id: string }).id).toBe(F1);
  });
});

describe("the administration behaviour (§ 4.4 – § 4.6)", () => {
  it("GET / pages the tenant's facilities: rows in data, paging in a top-level meta; another tenant's are absent", async () => {
    const res = await req(ctx.owner, "GET", "/", {}, { limit: "2", sort: "code" });
    expect(res.status).toBe(200);
    expect((bodyOf(res).data as { code: string }[]).map((f) => f.code)).toEqual(["F-0001", "F-0002"]);
    expect(bodyOf(res).meta).toEqual({ total: 5, page: 1, limit: 2, totalPages: 3 });
    const other = await req(ctx.other, "GET", "/");
    expect(bodyOf(other).data).toEqual([]);
  });

  it("GET / refuses an unknown query key (strict) with 400", async () => {
    expect((await req(ctx.owner, "GET", "/", {}, { tenantId: "x" })).status).toBe(400);
  });

  it("GET /options lists every facility of the tenant, short form, by name", async () => {
    const res = await req(ctx.owner, "GET", "/options");
    expect(res.status).toBe(200);
    expect((bodyOf(res).data as { name: string }[]).map((f) => f.name)).toEqual(["Created By Mistake", "Facility Ended", "Facility One", "Facility Two", "Self"]);
  });

  it("POST / creates an active, non-self facility with its audit row (201); a duplicate code is a 409", async () => {
    const res = await req(ctx.owner, "POST", "/", { name: "Facility Six", code: "f-0006", kind: "hospital" });
    expect(res.status).toBe(201);
    expect(bodyOf(res).data).toEqual(expect.objectContaining({ code: "F-0006", isSelf: false, status: "active" }));
    expect(testWrites()).toEqual(expect.arrayContaining(["ClientFacility", "AuditLog"]));
    expect((await req(ctx.owner, "POST", "/", { name: "Another", code: "F-0006" })).status).toBe(409);
  });

  it("POST / refuses isSelf, status and tenantId in the body (strict, 400)", async () => {
    for (const extra of [{ isSelf: true }, { status: "ended" }, { tenantId: F1 }]) {
      expect((await req(ctx.owner, "POST", "/", { name: "X", code: "F-0099", ...extra })).status).toBe(400);
    }
  });

  it("PATCH refuses a body with nothing to change (400) and the self facility's code (409)", async () => {
    expect((await req(ctx.owner, "PATCH", `/${F1}`, {})).status).toBe(400);
    expect((await req(ctx.owner, "PATCH", `/${SELF_A}`, { code: "MINE" })).status).toBe(409);
  });

  it("leaving active revokes the bound users' sessions in the same transaction", async () => {
    const res = await req(ctx.owner, "POST", `/${F1}/status`, { status: "ended", reason: "The client left" });
    expect(res.status).toBe(200);
    expect((bodyOf(res).data as { sessionsRevoked: number }).sessionsRevoked).toBe(1);
    expect(mdb.rows("Session").every((s) => s["is_revoked"] === true)).toBe(true);
    expect(testWrites()).toEqual(expect.arrayContaining(["ClientFacility", "Session", "AuditLog"]));
  });

  it("reinstating an ended facility needs a tenant administrator (403 for a SUPERVISOR with the grant; 200 for the admin)", async () => {
    expect((await req(supervisor, "POST", `/${F_ENDED}/status`, { status: "active", reason: "Contract renewed" })).status).toBe(403);
    expect((await req(ctx.owner, "POST", `/${F_ENDED}/status`, { status: "active", reason: "Contract renewed" })).status).toBe(200);
  });

  it("every status change of the self facility is a 409 with its explanation", async () => {
    const res = await req(ctx.owner, "POST", `/${SELF_A}/status`, { status: "inactive", reason: "Not allowed" });
    expect(res.status).toBe(409);
    expect(bodyOf(res).message).toMatch(/own facility/);
  });

  it("DELETE: a referenced facility is a 409 naming the counts; a SUPERVISOR is refused by rbac (403)", async () => {
    const res = await req(ctx.owner, "DELETE", `/${F1}`);
    expect(res.status).toBe(409);
    expect(bodyOf(res).message).toMatch(/holds 0 devices and 1 users/);
    expect((await req(supervisor, "DELETE", `/${F_EMPTY}`)).status).toBe(403);
  });

  it("GET /:clientFacilityId/users lists the facility's bound users", async () => {
    const res = await req(ctx.owner, "GET", `/${F1}/users`);
    expect(res.status).toBe(200);
    expect((bodyOf(res).data as { id: string }[]).map((u) => u.id)).toEqual([BOUND_USER]);
  });

  it.each([
    ["POST /", "POST", "/", { name: "Key Facility", code: "F-0077" }],
    ["PATCH", "PATCH", `/${F1}`, { name: "Key rename" }],
    ["status", "POST", `/${F2}/status`, { status: "inactive", reason: "Key pause" }],
    ["DELETE", "DELETE", `/${F_EMPTY}`, {}],
  ])("an API key is refused the write %s (403), nothing written", async (_key, method, path, body) => {
    const res = await req({ ...ctx.owner, isApiKey: true, apiKeyScopes: ["client-facilities:write"] }, method, path, body);
    expect(res.status).toBe(403);
    expect(testWrites()).toEqual([]);
  });
});
