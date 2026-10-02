/**
 * Phase 10 (ADR-098) — the small pieces around P10-04/05/07/10/12/15, each on
 * the REAL module:
 *  - config/publicAccess (the self-registration flag, the intake's secrets);
 *  - middlewares/selfRegistration (P10-12: off → the auth router behaves as if
 *    /register did not exist) — through the REAL auth router;
 *  - utils/mfaPolicy (Q-46: a passkey session is MFA);
 *  - the validators (normalisation, stripping, shape-only 400s);
 *  - loginDiscovery's SSO email-domain claim (super admin; memoryDb);
 *  - tenant.service#createTenant with an OUTER transaction (P10-05): no
 *    tenant and no cache entry survive a rolled-back approval.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as PublicAccess from "../../config/publicAccess";
import type * as MfaPolicy from "../../utils/mfaPolicy.util";
import type * as ArValidator from "../../validators/accessRequest.validator";
import type * as PaValidator from "../../validators/publicAuth.validator";
import type * as Discovery from "../../services/loginDiscovery.service";
import type * as Redis from "../../services/redis.service";
import type * as SelfRegistration from "../../middlewares/selfRegistration.middleware";
import type * as PlatformTenantModule from "../../constants/platformTenant";
import type * as RequestOriginModule from "../../utils/requestOrigin.util";
import type * as IdsModule from "../../types/ids";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); tests set variables on it, read per call. */
const penv = environment();

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/redis.service");
  return { ...actual, set: jest.fn(), get: jest.fn(), del: jest.fn(), delPattern: jest.fn() };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const publicAccess = jest.requireActual<typeof PublicAccess>("../../config/publicAccess");
const mfaPolicy = jest.requireActual<typeof MfaPolicy>("../../utils/mfaPolicy.util");
const ar = jest.requireActual<typeof ArValidator>("../../validators/accessRequest.validator");
const pa = jest.requireActual<typeof PaValidator>("../../validators/publicAuth.validator");
const discovery = jest.requireActual<typeof Discovery>("../../services/loginDiscovery.service");
const redis = jest.requireMock<typeof Redis>("../../services/redis.service");
const { selfRegistrationGate } = jest.requireActual<typeof SelfRegistration>("../../middlewares/selfRegistration.middleware");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- tenant.service is JavaScript
const tenantService = require("../../services/tenant.service") as {
  createTenant: (input: object, by: string | null, actor: object, options?: object) => Promise<{ data: { id: string } }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- auth.route is JavaScript
const authRouter = require("../../routes/api/auth.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- auth.service: spied on its one function
const authService = require("../../services/auth.service") as { registerUser: (...a: unknown[]) => Promise<unknown> };
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenantModule>(
  "../../constants/platformTenant",
);

/** Set (a string) or unset (undefined) a variable; Reflect, because `delete` of a computed key is a lint error. */
const setVar = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(penv, name);
  } else {
    penv[name] = value;
  }
};

const withEnv = async (vars: Record<string, string | undefined>, fn: () => unknown): Promise<void> => {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = penv[k];
    setVar(k, v);
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      setVar(k, v);
    }
  }
};

/** A stand-in for an Express argument the code under test does not read. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the parameter IS the point: the caller's parameter type is inferred
const unused = <T>(): T => ({}) as unknown as T;

beforeEach(() => {
  mdb.reset();
  (redis.set as jest.Mock).mockReset().mockResolvedValue(true);
  (redis.get as jest.Mock).mockReset().mockResolvedValue(null);
  (redis.del as jest.Mock).mockReset().mockResolvedValue(true);
  (redis.delPattern as jest.Mock).mockReset().mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
describe("utils/requestOrigin and types/ids#toTenantId", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded as the controllers load it
  const { requestOriginOf, actorIdOf } = require("../../utils/requestOrigin.util") as typeof RequestOriginModule;
  const { toTenantId } = jest.requireActual<typeof IdsModule>("../../types/ids");

  it("reads req.ip and a string user agent, else null — never the body", () => {
    type OriginReq = Parameters<typeof requestOriginOf>[0];
    const withUa: OriginReq = { ip: "10.0.0.1", headers: { "user-agent": "UA" } };
    const withoutIp: OriginReq = { ip: undefined, headers: {} };
    expect(requestOriginOf(withUa)).toEqual({ ip: "10.0.0.1", userAgent: "UA" });
    expect(requestOriginOf(withoutIp)).toEqual({ ip: null, userAgent: null });
    const actorReq: Parameters<typeof actorIdOf>[0] = { user: { id: 7 } } as unknown as Parameters<typeof actorIdOf>[0];
    expect(actorIdOf(actorReq)).toBe("7");
  });

  it("toTenantId accepts a UUID and refuses anything else", () => {
    expect(toTenantId("e1e1e1e1-0000-4000-8000-0000000000e1")).toBe("e1e1e1e1-0000-4000-8000-0000000000e1");
    expect(() => toTenantId("RS1")).toThrow("A tenant id must be a UUID");
  });
});

// ============================================================================
describe("config/publicAccess", () => {
  it("self-registration: explicit true/false win; unset is OFF in production and ON elsewhere", async () => {
    await withEnv({ SELF_REGISTRATION_ENABLED: undefined, NODE_ENV: "production" }, () => { expect(publicAccess.selfRegistrationEnabled()).toBe(false); },
    );
    await withEnv({ SELF_REGISTRATION_ENABLED: " ", NODE_ENV: "test" }, () => { expect(publicAccess.selfRegistrationEnabled()).toBe(true); },
    );
    await withEnv({ SELF_REGISTRATION_ENABLED: "TRUE", NODE_ENV: "production" }, () => { expect(publicAccess.selfRegistrationEnabled()).toBe(true); },
    );
    await withEnv({ SELF_REGISTRATION_ENABLED: "false", NODE_ENV: "test" }, () => { expect(publicAccess.selfRegistrationEnabled()).toBe(false); },
    );
  });

  it("the notify address is optional; the IP pepper is required in production only", async () => {
    await withEnv({ ACCESS_REQUEST_NOTIFY_EMAIL: "" }, () => { expect(publicAccess.accessRequestNotifyEmail()).toBeNull(); });
    await withEnv({ ACCESS_REQUEST_NOTIFY_EMAIL: " ops@x.test " }, () => { expect(publicAccess.accessRequestNotifyEmail()).toBe("ops@x.test"); },
    );
    await withEnv({ ACCESS_REQUEST_IP_PEPPER: undefined, NODE_ENV: "production" }, () => {
      expect(() => { publicAccess.assertPublicAccessConfig(); }).toThrow("ACCESS_REQUEST_IP_PEPPER is required in production");
    });
    await withEnv({ ACCESS_REQUEST_IP_PEPPER: undefined, NODE_ENV: "test" }, () => { expect(publicAccess.accessRequestIpPepper()).toBe(publicAccess.DEVELOPMENT_IP_PEPPER); },
    );
    await withEnv({ ACCESS_REQUEST_IP_PEPPER: "s3cret", NODE_ENV: "production" }, () => { expect(publicAccess.accessRequestIpPepper()).toBe("s3cret"); },
    );
  });

  it("Q-42 (ADR-113): the privacy notice is an absolute http(s) URL or nothing, in every environment", async () => {
    const cases: [string | undefined, string | null][] = [
      [undefined, null],
      [" ", null],
      ["/privacy", null],
      ["ftp://example.test/privacy", null],
      [" https://example.test/privacy ", "https://example.test/privacy"],
      ["http://localhost:3000/privacy", "http://localhost:3000/privacy"],
    ];
    for (const [value, expected] of cases) {
      for (const NODE_ENV of ["production", "test"]) {
        await withEnv({ PRIVACY_NOTICE_URL: value, NODE_ENV }, () => { expect(publicAccess.privacyNoticeUrl()).toBe(expected); });
      }
    }
  });
});

// ============================================================================
describe("P10-12 — the self-registration gate", () => {
  it("passes through when enabled, and leaves the ROUTER when disabled", async () => {
    const next = jest.fn();
    await withEnv({ SELF_REGISTRATION_ENABLED: "true" }, () => { selfRegistrationGate(unused(), unused(), next); });
    expect(next).toHaveBeenLastCalledWith();
    await withEnv({ SELF_REGISTRATION_ENABLED: "false" }, () => { selfRegistrationGate(unused(), unused(), next); });
    expect(next).toHaveBeenLastCalledWith("router");
  });

  it("disabled (production default), POST /auth/register through the REAL auth router is 404 'Route not found' — nothing registered", async () => {
    const register = jest.spyOn(authService, "registerUser");
    as(null);
    await withEnv({ SELF_REGISTRATION_ENABLED: "false" }, async () => {
      const res = await call(authRouter, "POST", "/register", {
        body: { firstName: "Ada", username: "ada", email: "ada@x.test", password: "Str0ngPassw0rd" },
      });
      const absent = await call(authRouter, "POST", "/no-such-route", { body: {} });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(absent.body);
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("enabled, the route answers the one neutral 202 (the service decides nothing else is said)", async () => {
    jest.spyOn(authService, "registerUser").mockResolvedValue({
      success: true,
      status: 202,
      message: "If the address can be registered, an activation link has been sent",
    });
    as(null);
    await withEnv({ SELF_REGISTRATION_ENABLED: "true" }, async () => {
      const res = await call(authRouter, "POST", "/register", {
        body: { firstName: "Ada", username: "ada", email: "ada@x.test", password: "Str0ngPassw0rd" },
      });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        success: true,
        status: 202,
        message: "If the address can be registered, an activation link has been sent",
        data: null,
      });
    });
  });
});

// ============================================================================
describe("Q-46 — a passkey session is multi-factor", () => {
  const operator = { role: { name: "SUPERADMIN", roleLevel: 10 }, mfaEnabled: false };
  const policyUser = { role: { name: "TECHNICIAN", roleLevel: 5 }, mfaEnabled: false, mfaPolicy: { required: true, minRoleLevel: null } };

  it("passkey is the one multi-factor method", () => {
    expect(mfaPolicy.isMultiFactorMethod("passkey")).toBe(true);
    for (const m of ["password", "password+totp", "saml", "oidc", null, undefined]) {
      expect(mfaPolicy.isMultiFactorMethod(m)).toBe(false);
    }
  });

  it("satisfies P6-07 for an operator and a tenant's MFA policy alike; a password session still does not", () => {
    expect(mfaPolicy.mfaEnrolmentRequired(operator, null, { method: "passkey" })).toBe(false);
    expect(mfaPolicy.mfaEnrolmentRequired(policyUser, null, { method: "passkey" })).toBe(false);
    expect(mfaPolicy.mfaEnrolmentRequired(operator, null, { method: "password" })).toBe(true);
    expect(mfaPolicy.mfaEnrolmentRequired(policyUser, null, { method: "password" })).toBe(true);
  });
});

// ============================================================================
describe("the validators", () => {
  const body = {
    organisationName: " RS ",
    facilityType: "clinic",
    city: "Solo",
    deviceCountBand: "lt_100",
    contactName: "Ana",
    workEmail: " ANA@X.TEST ",
    whatsapp: "62 812 3456 789",
    consent: true,
    consentVersion: "v1",
    locale: "en",
  };

  it("normalises WhatsApp numbers to E.164", () => {
    expect(ar.normaliseWhatsapp("0812-3456-7890")).toBe("+6281234567890");
    expect(ar.normaliseWhatsapp("62 812 3456 7890")).toBe("+6281234567890");
    expect(ar.normaliseWhatsapp("+44 (20) 7946.0958")).toBe("+442079460958");
  });

  it("the intake: trims, lower-cases, blanks read as absent, the honeypot defaults to empty, unknown keys vanish", () => {
    const parsed = ar.submitAccessRequestSchema.parse({ ...body, contactRole: "  ", needs: null, status: "approved" });
    expect(parsed).toMatchObject({ organisationName: "RS", workEmail: "ana@x.test", whatsapp: "+628123456789", contactRole: null, needs: null, website: "" });
    expect(parsed).not.toHaveProperty("status");
    expect(ar.submitAccessRequestSchema.safeParse({ ...body, consent: false }).success).toBe(false);
    expect(ar.submitAccessRequestSchema.safeParse({ ...body, whatsapp: "abc" }).success).toBe(false);
  });

  it("the queue, approve, reject and domain schemas", () => {
    expect(ar.listAccessRequestsSchema.parse({})).toEqual({ status: "pending", page: 1, limit: 20 });
    expect(ar.approveAccessRequestSchema.safeParse({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", tenantCode: "a b" }).success).toBe(false);
    expect(ar.rejectAccessRequestSchema.parse({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", reason: "x" }).spam).toBe(false);
    expect(pa.ssoEmailDomainsSchema.safeParse({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", domains: ["not a domain"] }).success).toBe(false);
    expect(pa.passkeyVerifySchema.safeParse({ ceremonyId: "A".repeat(43), credential: { id: "a", rawId: "a", type: "public-key", response: { clientDataJSON: "a", authenticatorData: "a", signature: "a+/" } } }).success).toBe(false);
  });
});

// ============================================================================
describe("P10-04 — the SSO email-domain claim (super admin)", () => {
  const T1 = "e1e1e1e1-0000-4000-8000-0000000000e1";
  const T2 = "e2e2e2e2-0000-4000-8000-0000000000e2";
  const ACTOR = { userId: "f1f1f1f1-0000-4000-8000-0000000000f1", ipAddress: null, userAgent: null };

  beforeEach(() => {
    mdb.seed("Tenant", [
      { id: PLATFORM_TENANT_ID, name: "P", code: "PLATFORM", subdomain: "p", email: "p@p.test", status: "active" },
      { id: T1, name: "RS 1", code: "RS1", subdomain: "rs1", email: "a@a.test", status: "active" },
      { id: T2, name: "RS 2", code: "RS2", subdomain: "rs2", email: "b@b.test", status: "active" },
    ]);
  });

  it("domainOf and parseDomains", () => {
    expect(discovery.domainOf("a@B.Test")).toBe("b.test");
    expect(discovery.domainOf("@b.test")).toBeNull();
    expect(discovery.domainOf("a@")).toBeNull();
    expect(discovery.domainOf("ana")).toBeNull();
    expect(discovery.parseDomains(null)).toEqual([]);
    expect(discovery.parseDomains("")).toEqual([]);
    expect(discovery.parseDomains("{not json")).toEqual([]);
    expect(discovery.parseDomains('{"a":1}')).toEqual([]);
    expect(discovery.parseDomains('["a.test", 3]')).toEqual(["a.test"]);
  });

  it("another tenant's claim that does not overlap does not block", async () => {
    await discovery.setSsoEmailDomains(T2, ["rs2.test"], ACTOR);
    expect(await discovery.setSsoEmailDomains(T1, ["rs1.test"], ACTOR)).toEqual(["rs1.test"]);
  });

  it("claims, replaces, audits under PLATFORM; another tenant's domain is 409; a webmail domain 400; an unknown tenant 404", async () => {
    expect(await discovery.setSsoEmailDomains(T1, ["rs1.test", "RS1.test", "b.rs1.test"], ACTOR)).toEqual(["b.rs1.test", "rs1.test"]);
    expect(await discovery.getSsoEmailDomains(T1)).toEqual(["b.rs1.test", "rs1.test"]);
    expect(await discovery.setSsoEmailDomains(T1, ["rs1.test"], ACTOR)).toEqual(["rs1.test"]);
    expect(mdb.rows("TenantSettings").filter((r) => r["key"] === "sso_email_domains")).toHaveLength(1);

    const audits = mdb.rows("AuditLog");
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ tenantId: PLATFORM_TENANT_ID, action: "UPDATE", resourceType: "Tenant", resourceId: T1 });
    expect(audits[1]?.["changes"]).toEqual({
      operation: "SSO_EMAIL_DOMAINS_SET",
      before: { domains: ["b.rs1.test", "rs1.test"] },
      after: { domains: ["rs1.test"] },
    });

    await expect(discovery.setSsoEmailDomains(T2, ["rs1.test"], ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "rs1.test is already claimed by tenant RS1; remove it there first.",
    });
    await expect(discovery.setSsoEmailDomains(T2, ["gmail.com"], ACTOR)).rejects.toMatchObject({ status: 400 });
    await expect(
      discovery.setSsoEmailDomains("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ["x.test"], ACTOR),
    ).rejects.toMatchObject({ status: 404 });
    expect(await discovery.getSsoEmailDomains(T2)).toEqual([]);
  });

  it("a conflicting claim held by a tenant row that is gone names its id", async () => {
    mdb.seed("TenantSettings", { tenantId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", key: "sso_email_domains", value: '["gone.test"]' });
    await expect(discovery.setSsoEmailDomains(T1, ["gone.test"], ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "gone.test is already claimed by tenant eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee; remove it there first.",
    });
  });

  it("a claim naming a tenant that no longer exists falls back to the password step", async () => {
    mdb.seed("TenantSettings", { tenantId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", key: "sso_email_domains", value: '["ghost.test"]' });
    expect(await discovery.discoverSignIn("a@ghost.test", unused())).toEqual({ next: "password" });
  });
});

// ============================================================================
describe("P10-05 — createTenant inside an OUTER transaction", () => {
  const INPUT = { name: "RS Outer", code: "OUTER", email: "o@o.test" };

  beforeEach(() => {
    mdb.seed("Tenant", { id: PLATFORM_TENANT_ID, name: "P", code: "PLATFORM", subdomain: "p", email: "p@p.test", status: "active" });
  });

  it("an outer transaction that rolls back leaves no tenant, no audit row and no cache entry", async () => {
    const outer = await mdb.sequelize.transaction();
    await tenantService.createTenant(INPUT, "f1f1f1f1-0000-4000-8000-0000000000f1", {}, { transaction: outer });
    expect(redis.set).not.toHaveBeenCalled();
    await outer.rollback();
    expect(mdb.rows("Tenant").filter((t) => t["code"] === "OUTER")).toHaveLength(0);
    expect(mdb.rows("AuditLog")).toHaveLength(0);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("an outer transaction that commits writes the cache after the commit", async () => {
    const outer = await mdb.sequelize.transaction();
    const created = await tenantService.createTenant(INPUT, "f1f1f1f1-0000-4000-8000-0000000000f1", {}, { transaction: outer });
    expect(redis.set).not.toHaveBeenCalled();
    await outer.commit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(created.data.id), expect.anything(), 600);
  });

  it("a code clash is 409 and the OUTER transaction is left to its owner (still open)", async () => {
    mdb.seed("Tenant", { id: "7e7e7e7e-0000-4000-8000-00000000007e", name: "X", code: "OUTER", subdomain: "x", email: "x@x.test", status: "active" });
    const outer = await mdb.sequelize.transaction();
    await expect(tenantService.createTenant(INPUT, "f1f1f1f1-0000-4000-8000-0000000000f1", {}, { transaction: outer })).rejects.toMatchObject({ status: 409 });
    expect((outer as unknown as { finished?: string }).finished).toBeUndefined();
    await outer.rollback();
  });

  it("a failed cache write after commit is logged, not thrown", async () => {
    (redis.set as jest.Mock).mockRejectedValue(new Error("redis down"));
    const outer = await mdb.sequelize.transaction();
    await tenantService.createTenant(INPUT, "f1f1f1f1-0000-4000-8000-0000000000f1", {}, { transaction: outer });
    await outer.commit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mdb.rows("Tenant").filter((t) => t["code"] === "OUTER")).toHaveLength(1);
  });
});
