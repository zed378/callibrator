/**
 * P10-05 / P10-07 (ADR-098 §6) — the access-request routes through their REAL
 * chains: the public intake (accessRequests.route.ts: request budget, Zod
 * validate, controller, service) and the admin queue (admin.route.js:
 * `router.use(auth)` + `rbac(SUPER_ADMIN)`, validate, controller, service),
 * over the REAL models, hooks and audit service (fixtures/memoryDb). Only
 * `auth` is replaced (fixtures/routeClient), so the principal is chosen.
 *
 * BR-P10-2 (neutrality) is pinned here at the HTTP level: a new request, a
 * duplicate, an over-cap address and a honeypot hit get byte-identical
 * answers — status, body and headers.
 *
 * The queue's `:id` routes are allow-listed as `platform` in the two-tenant
 * guard (the table has no tenant); the proof that no tenant principal reaches
 * them — 403 for a tenant administrator in their own tenant — is here.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Redis from "../../services/redis.service";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as EmailQueue from "../../services/emailQueue.service";
import type * as BcryptModule from "bcryptjs";
import type * as ConstantsModule from "../../constants";
import type * as PlatformTenantModule from "../../constants/platformTenant";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); tests set variables on it, read per call. */
const penv = environment();

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/redis.service");
  return { ...actual, set: jest.fn(), get: jest.fn(), del: jest.fn(), delPattern: jest.fn() };
});
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof BcryptModule>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { as, call, twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const redis = jest.requireMock<typeof Redis>("../../services/redis.service");
const rateLimiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the routers are loaded after the mocks
const publicRouter = require("../../routes/api/accessRequests.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- admin.route is JavaScript
const adminRouter = require("../../routes/api/admin.route") as unknown;
const emailQueue = jest.requireActual<typeof EmailQueue>("../../services/emailQueue.service");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenantModule>(
  "../../constants/platformTenant",
);
const { ROLE_IDS } = jest.requireActual<typeof ConstantsModule>("../../constants");

const BODY = {
  organisationName: "RSUD Contoh Sejahtera",
  facilityType: "hospital",
  city: "Bandung",
  deviceCountBand: "500_1999",
  contactName: "Siti Rahma",
  contactRole: "Kepala IPSRS",
  workEmail: "Siti@RSUD-contoh.go.id",
  whatsapp: "0812-3456-7890",
  needs: "Jadwal kalibrasi",
  consent: true,
  consentVersion: "2026-09-29",
  locale: "id",
  website: "",
};

let fx: RouteClient.TwoTenantWorld;

beforeEach(() => {
  mdb.reset();
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
  (redis.set as jest.Mock).mockReset().mockResolvedValue(true);
  (redis.get as jest.Mock).mockReset().mockResolvedValue(null);
  (redis.del as jest.Mock).mockReset().mockResolvedValue(true);
  (redis.delPattern as jest.Mock).mockReset().mockResolvedValue(0);
  // Observed, never sent (no broker in a unit test).
  jest.spyOn(emailQueue, "queueNotificationEmail").mockResolvedValue(true);
  fx = twoTenants();
  seedTenants(mdb, fx, [fx.superAdmin]);
  mdb.seed("Tenant", {
    id: PLATFORM_TENANT_ID,
    name: "Platform",
    code: "PLATFORM",
    subdomain: "platform",
    email: "p@p.test",
    status: "active",
  });
  mdb.seed("Role", [
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 10 },
    { id: ROLE_IDS.HEALTCARE_ADMIN, name: "HEALTHCARE ADMIN", roleLevel: 8 },
    { id: ROLE_IDS.CALIBRATOR_ADMIN, name: "CALIBRATOR ADMIN", roleLevel: 8 },
  ]);
});

const submit = (body: Record<string, unknown> = BODY, ip?: string): Promise<RouteClient.RouteResponse> => {
  as(null);
  return call(publicRouter, "POST", "/", { body, ...(ip ? { headers: { "x-test-ip": ip } } : {}) });
};

const admin = (method: string, url: string, body?: unknown, query?: Record<string, unknown>) =>
  call(adminRouter, method, url, { body: body ?? {}, query: query ?? {} });

const stored = (): MemoryDbModule.Row[] => mdb.rows("AccessRequest");

// ============================================================================
describe("P10-05 — POST /access-requests (public)", () => {
  it("works with NO token and answers the neutral 202", async () => {
    const res = await submit();
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ success: true, status: 202, message: "Request received", data: null });
    expect(stored()).toHaveLength(1);
    // Normalised: the address lower-cased, the number E.164.
    expect(stored()[0]).toMatchObject({ workEmail: "siti@rsud-contoh.go.id", whatsapp: "+6281234567890", status: "pending" });
  });

  it("BR-P10-5: tenantId, status, decidedBy and provisionedTenantId in the body are stripped — never read", async () => {
    const res = await submit({
      ...BODY,
      tenantId: fx.tenantA.id,
      status: "approved",
      decidedBy: fx.superAdmin.id,
      provisionedTenantId: fx.tenantA.id,
      adminUserId: fx.superAdmin.id,
    });
    expect(res.status).toBe(202);
    const [row] = stored();
    expect(row?.["status"]).toBe("pending");
    expect(row?.["provisionedTenantId"] ?? null).toBeNull();
    expect(row?.["decidedBy"] ?? null).toBeNull();
    expect(row?.["adminUserId"] ?? null).toBeNull();
    expect(Object.keys(row ?? {})).not.toContain("tenantId");
  });

  it("BR-P10-2: new, duplicate, over-cap and honeypot submissions get the IDENTICAL answer (status, body, headers)", async () => {
    const answers: RouteClient.RouteResponse[] = [];
    answers.push(await submit()); // new
    answers.push(await submit()); // duplicate
    await submit(); // third: the cap is 3 per address per 24 h
    answers.push(await submit()); // over the cap: not stored
    answers.push(await submit({ ...BODY, workEmail: "bot@x.test", website: "http://spam.example" })); // honeypot
    expect(stored()).toHaveLength(3);
    for (const answer of answers.slice(1)) {
      expect(answer.status).toBe(answers[0]?.status);
      expect(answer.body).toEqual(answers[0]?.body);
      expect(answer.headers).toEqual(answers[0]?.headers);
    }
  });

  it("a 400 describes the SHAPE only: consent missing, a bad email, a bad number, an unknown enum", async () => {
    for (const body of [
      { ...BODY, consent: false },
      { ...BODY, workEmail: "not-an-email" },
      { ...BODY, whatsapp: "12" },
      { ...BODY, facilityType: "spaceport" },
      { ...BODY, organisationName: "" },
    ]) {
      const res = await submit(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, status: 400 });
    }
    expect(stored()).toHaveLength(0);
  });

  it("the per-address request budget answers 429 with Retry-After on the 6th request in an hour (production figures)", async () => {
    penv["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await submit({ ...BODY, workEmail: `x${String(i)}@rs.test` })).status);
      }
      expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
      const last = await submit({ ...BODY, workEmail: "y@rs.test" });
      expect(last.status).toBe(429);
      expect(last.headers["retry-after"]).toBeDefined();
      expect(last.body).toMatchObject({ success: false, status: 429 });
    } finally {
      delete penv["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
    }
    expect(stored()).toHaveLength(5);
  });
});

// ============================================================================
describe("P10-07 — the admin queue is the super admin's alone", () => {
  const ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const routes: [string, string, unknown][] = [
    ["GET", "/access-requests", undefined],
    ["GET", `/access-requests/${ID}`, undefined],
    ["POST", `/access-requests/${ID}/approve`, { tenantCode: "RSX" }],
    ["POST", `/access-requests/${ID}/reject`, { reason: "no" }],
    ["POST", `/access-requests/${ID}/resend-invitation`, {}],
    ["POST", "/access-requests/erasure", { email: "a@b.test" }],
    ["GET", `/tenants/${ID}/sso-domains`, undefined],
    ["PUT", `/tenants/${ID}/sso-domains`, { domains: ["rs.test"] }],
  ];

  it.each(routes)("%s %s — 401 with no token", async (method, url, body) => {
    as(null);
    expect((await admin(method, url, body)).status).toBe(401);
  });

  it.each(routes)("%s %s — 403 for a tenant ADMIN in their own tenant (a permission failure, not a 404)", async (method, url, body) => {
    for (const role of ["HEALTCARE_ADMIN", "CALIBRATOR_ADMIN"]) {
      as(fx.principal(fx.tenantA, role));
      expect((await admin(method, url, body)).status).toBe(403);
    }
    expect(stored()).toHaveLength(0);
  });

  it("the super admin lists (rows in `data`, pagination and counts in a TOP-LEVEL `meta`), reads, approves", async () => {
    await submit();
    as(fx.superAdmin);
    const list = await admin("GET", "/access-requests", undefined, { status: "pending", page: "1", limit: "10" });
    expect(list.status).toBe(200);
    const body = list.body as { data: { id: string }[]; meta: Record<string, unknown> };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ total: 1, page: 1, limit: 10, counts: { pending: 1 } });
    const id = body.data[0]?.id ?? "";

    const detail = await admin("GET", `/access-requests/${id}`);
    expect(detail.status).toBe(200);
    expect((detail.body as { data: { id: string } }).data.id).toBe(id);

    const approved = await admin("POST", `/access-requests/${id}/approve`, { tenantCode: "RSUDCS" });
    expect(approved.status).toBe(200);
    expect((approved.body as { data: { request: { status: string } } }).data.request.status).toBe("approved");

    // Again: the 409 carries the state explanation.
    const again = await admin("POST", `/access-requests/${id}/approve`, { tenantCode: "RSUDCS2" });
    expect(again.status).toBe(409);
    expect((again.body as { message: string }).message).toMatch(/already approved on/);
  });

  it("the super admin re-issues an approved request's invitation (a user agent is recorded)", async () => {
    await submit();
    as(fx.superAdmin);
    const id = String(stored()[0]?.["id"]);
    await admin("POST", `/access-requests/${id}/approve`, { tenantCode: "RSUDCS" });
    const res = await call(adminRouter, "POST", `/access-requests/${id}/resend-invitation`, {
      body: {},
      headers: { "user-agent": "Queue/1.0" },
    });
    expect(res.status).toBe(200);
    expect((res.body as { data: { invitationSent: boolean } }).data.invitationSent).toBe(true);
    const reissued = mdb
      .rows("AuditLog")
      .find((a) => (a["changes"] as { operation?: string } | null)?.operation === "INVITATION_REISSUED");
    expect(reissued).toMatchObject({ userAgent: "Queue/1.0", userId: fx.superAdmin.id });
  });

  it("the super admin rejects; a reason is required (400); a malformed id is 400; an unknown one 404", async () => {
    await submit();
    as(fx.superAdmin);
    const id = String(stored()[0]?.["id"]);
    expect((await admin("POST", `/access-requests/${id}/reject`, {})).status).toBe(400);
    expect((await admin("POST", "/access-requests/not-a-uuid/reject", { reason: "x" })).status).toBe(400);
    expect((await admin("GET", "/access-requests/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).status).toBe(404);
    const res = await admin("POST", `/access-requests/${id}/reject`, { reason: "Bukan faskes", spam: true });
    expect(res.status).toBe(200);
    expect(stored()[0]).toMatchObject({ status: "spam", decisionNote: "Bukan faskes" });
  });

  it("the approve body cannot choose the invited address (only the request's own is used)", async () => {
    await submit();
    as(fx.superAdmin);
    const id = String(stored()[0]?.["id"]);
    await admin("POST", `/access-requests/${id}/approve`, { tenantCode: "RSUDCS", email: "attacker@evil.test", adminEmail: "a@evil.test" });
    expect(mdb.rows("User").some((u) => String(u["email"]).includes("evil.test"))).toBe(false);
    expect(mdb.rows("User").some((u) => u["email"] === "siti@rsud-contoh.go.id")).toBe(true);
  });

  it("the erasure route and the SSO-domain routes answer the super admin", async () => {
    await submit();
    as(fx.superAdmin);
    const erased = await admin("POST", "/access-requests/erasure", { email: "siti@rsud-contoh.go.id" });
    expect(erased.status).toBe(200);
    expect((erased.body as { data: unknown }).data).toEqual({ deleted: 1, masked: 0 });

    const put = await admin("PUT", `/tenants/${fx.tenantA.id}/sso-domains`, { domains: ["RS-A.test", "rs-a.test"] });
    expect(put.status).toBe(200);
    expect((put.body as { data: unknown }).data).toEqual({ domains: ["rs-a.test"] });
    const get = await admin("GET", `/tenants/${fx.tenantA.id}/sso-domains`);
    expect((get.body as { data: unknown }).data).toEqual({ domains: ["rs-a.test"] });
  });
});
