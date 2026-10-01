/**
 * P10-04 / P10-10 / P10-15 (ADR-098) — the public sign-in routes through their
 * REAL chains (authPublic.route.ts: request budget, Zod validate, controller,
 * service; sso.controller#startSsoFor), over the REAL models, tenant hooks and
 * settings (fixtures/memoryDb). No token anywhere: every route is public.
 *
 * The no-oracle rules, pinned at the HTTP level:
 *  - discovery answers by DOMAIN only: an existing and a non-existent address
 *    in the same domain get identical answers (P10-04 DoD);
 *  - an SSO start refuses an unknown code, SSO off, and SSO misconfigured
 *    (no protocol; an unreachable OIDC IdP) with ONE identical answer (A-292);
 *  - the passkey options carry nothing about any account;
 *  - a bad invitation token is ONE 400.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Redis from "../../services/redis.service";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); tests set variables on it, read per call. */
const penv = environment();

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/redis.service");
  return { ...actual, set: jest.fn(), get: jest.fn(), getDel: jest.fn(), del: jest.fn(), delPattern: jest.fn() };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const redis = jest.requireMock<typeof Redis>("../../services/redis.service");
const rateLimiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks
const router = require("../../routes/api/authPublic.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- oidcJwks is JavaScript; spied on its one function
const oidcJwks = require("../../services/oidcJwks") as { discover: (s: unknown) => Promise<{ authorizationEndpoint: string }> };

const TENANT_SAML = "c1c1c1c1-0000-4000-8000-0000000000c1";
const TENANT_OIDC = "c2c2c2c2-0000-4000-8000-0000000000c2";
const TENANT_OFF = "c3c3c3c3-0000-4000-8000-0000000000c3";
const TENANT_BARE = "c4c4c4c4-0000-4000-8000-0000000000c4";

const tenant = (id: string, code: string): Record<string, unknown> => ({
  id,
  name: `RS ${code}`,
  code,
  subdomain: code.toLowerCase(),
  email: `${code.toLowerCase()}@x.test`,
  status: "active",
});

const setting = (tenantId: string, key: string, value: string): Record<string, unknown> => ({ tenantId, key, value });

beforeEach(() => {
  mdb.reset();
  as(null);
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
  const store = new Map<string, unknown>();
  (redis.set as jest.Mock).mockReset().mockImplementation(async (k: string, v: unknown) => {
    store.set(k, v);
    return Promise.resolve(true);
  });
  (redis.get as jest.Mock).mockReset().mockResolvedValue(null);
  (redis.getDel as jest.Mock).mockReset().mockImplementation(async (k: string) => {
    const v = store.get(k) ?? null;
    store.delete(k);
    return Promise.resolve(v);
  });
  mdb.seed("Tenant", [
    tenant(TENANT_SAML, "RSSAML"),
    tenant(TENANT_OIDC, "RSOIDC"),
    tenant(TENANT_OFF, "RSOFF"),
    tenant(TENANT_BARE, "RSBARE"),
  ]);
  mdb.seed("TenantSettings", [
    setting(TENANT_SAML, "sso_enabled", "true"),
    setting(TENANT_SAML, "sso_idp_entry_point", "https://idp.rs-saml.test/sso"),
    setting(TENANT_SAML, "sso_email_domains", JSON.stringify(["rs-saml.test"])),
    setting(TENANT_OIDC, "sso_enabled", "true"),
    setting(TENANT_OIDC, "oidc_client_id", "callibrator"),
    setting(TENANT_OIDC, "oidc_authority", "https://login.rs-oidc.test"),
    setting(TENANT_OIDC, "sso_email_domains", JSON.stringify(["rs-oidc.test"])),
    setting(TENANT_OFF, "sso_enabled", "false"),
    setting(TENANT_OFF, "sso_idp_entry_point", "https://idp.rs-off.test/sso"),
    setting(TENANT_OFF, "sso_email_domains", JSON.stringify(["rs-off.test"])),
    setting(TENANT_BARE, "sso_enabled", "true"),
  ]);
  mdb.seed("User", {
    id: "d1d1d1d1-0000-4000-8000-0000000000d1",
    tenantId: TENANT_SAML,
    email: "ana@rs-saml.test",
    username: "ana",
    password: "x",
    firstName: "Ana",
    lastName: "S",
    status: "ACTIVE",
    isActive: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const post = (url: string, body: unknown = {}): Promise<RouteClient.RouteResponse> => call(router, "POST", url, { body });
const dataOf = (res: RouteClient.RouteResponse): Record<string, unknown> =>
  (res.body as { data: Record<string, unknown> }).data;

// ============================================================================
describe("P10-04 — POST /auth/login/discover (public, by domain only)", () => {
  it("a username (no @) is always the password step", async () => {
    const res = await post("/login/discover", { identifier: "ana" });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({ next: "password" });
  });

  it("an address whose domain nobody claimed is the password step", async () => {
    expect(dataOf(await post("/login/discover", { identifier: "someone@elsewhere.test" }))).toEqual({ next: "password" });
  });

  it("a claimed SAML domain redirects to the IdP — IDENTICALLY for an existing and a non-existent account", async () => {
    const known = await post("/login/discover", { identifier: "ana@rs-saml.test" });
    const unknown = await post("/login/discover", { identifier: "nobody-here@RS-SAML.test" });
    expect(known.status).toBe(200);
    expect(dataOf(known)["next"]).toBe("sso");
    expect(String(dataOf(known)["redirectUrl"])).toMatch(/^https:\/\/idp\.rs-saml\.test\/sso\?SAMLRequest=.+&RelayState=RSSAML$/);
    // The SAML request id differs per call; everything else is the same.
    const mask = (r: RouteClient.RouteResponse): unknown =>
      JSON.parse(JSON.stringify(r.body).replace(/SAMLRequest=[^&"]+/, "SAMLRequest=X")) as unknown;
    expect(unknown.status).toBe(known.status);
    expect(mask(unknown)).toEqual(mask(known));
    expect(unknown.headers).toEqual(known.headers);
  });

  it("a claimed OIDC domain starts OIDC (the binding cookie is set on the response)", async () => {
    jest.spyOn(oidcJwks, "discover").mockResolvedValue({ authorizationEndpoint: "https://login.rs-oidc.test/authorize" });
    const res = await post("/login/discover", { identifier: "budi@rs-oidc.test" });
    expect(dataOf(res)["next"]).toBe("sso");
    expect(String(dataOf(res)["redirectUrl"])).toMatch(/^https:\/\/login\.rs-oidc\.test\/authorize\?/);
  });

  it("a claimed domain whose SSO is off, or whose IdP is unreachable, falls back to the password step", async () => {
    expect(dataOf(await post("/login/discover", { identifier: "x@rs-off.test" }))).toEqual({ next: "password" });
    jest.spyOn(oidcJwks, "discover").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(dataOf(await post("/login/discover", { identifier: "x@rs-oidc.test" }))).toEqual({ next: "password" });
  });

  it("an empty identifier is a 400 about its shape", async () => {
    expect((await post("/login/discover", { identifier: "" })).status).toBe(400);
  });
});

// ============================================================================
describe("P10-04 — POST /auth/sso/start (public, one refusal)", () => {
  it("OIDC's redirect_uri: the tenant's own when set, else HOST_URL's, else the development default", async () => {
    jest.spyOn(oidcJwks, "discover").mockResolvedValue({ authorizationEndpoint: "https://login.rs-oidc.test/authorize" });
    const saved = penv["HOST_URL"];
    try {
      delete penv["HOST_URL"];
      const dev = await post("/sso/start", { orgCode: "RSOIDC" });
      expect(decodeURIComponent(String(dataOf(dev)["redirectUrl"]))).toContain("http://localhost:5000/api/v1/auth/sso/oidc/callback/RSOIDC");
      penv["HOST_URL"] = "https://api.example.test";
      const host = await post("/sso/start", { orgCode: "RSOIDC" });
      expect(decodeURIComponent(String(dataOf(host)["redirectUrl"]))).toContain("https://api.example.test/api/v1/auth/sso/oidc/callback/RSOIDC");
      mdb.seed("TenantSettings", { tenantId: TENANT_OIDC, key: "oidc_redirect_uri", value: "https://custom.example.test/cb" });
      const own = await post("/sso/start", { orgCode: "RSOIDC" });
      expect(decodeURIComponent(String(dataOf(own)["redirectUrl"]))).toContain("https://custom.example.test/cb");
    } finally {
      if (saved === undefined) {
        delete penv["HOST_URL"];
      } else {
        penv["HOST_URL"] = saved;
      }
    }
  });

  it("SAML when only SAML is configured", async () => {
    const res = await post("/sso/start", { orgCode: "RSSAML" });
    expect(res.status).toBe(200);
    expect(String(dataOf(res)["redirectUrl"])).toMatch(/^https:\/\/idp\.rs-saml\.test\/sso\?SAMLRequest=/);
  });

  it("OIDC when an OIDC client is configured — the protocol is the server's choice", async () => {
    jest.spyOn(oidcJwks, "discover").mockResolvedValue({ authorizationEndpoint: "https://login.rs-oidc.test/authorize" });
    const res = await post("/sso/start", { orgCode: "RSOIDC" });
    expect(res.status).toBe(200);
    expect(String(dataOf(res)["redirectUrl"])).toMatch(/^https:\/\/login\.rs-oidc\.test\/authorize\?/);
  });

  it("unknown code, SSO off, no protocol configured and an unreachable IdP are ONE identical answer (A-292)", async () => {
    jest.spyOn(oidcJwks, "discover").mockRejectedValue(new Error("ECONNREFUSED"));
    const answers = [
      await post("/sso/start", { orgCode: "NOPE" }),
      await post("/sso/start", { orgCode: "RSOFF" }),
      await post("/sso/start", { orgCode: "RSBARE" }),
      await post("/sso/start", { orgCode: "RSOIDC" }),
    ];
    // `details` (a stack) exists only outside production (response.util#error); production sends none.
    const withoutDetails = (body: unknown): unknown => ({ ...(body as Record<string, unknown>), details: undefined });
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(withoutDetails(answer.body)).toEqual(withoutDetails(answers[0]?.body));
      expect(answer.headers).toEqual(answers[0]?.headers);
    }
    expect(answers[0]?.body).toMatchObject({ message: "Single sign-on is not available for this organisation code" });
  });
});

// ============================================================================
describe("P10-10 — the passkey routes are reachable with no token", () => {
  it("POST /passkey/options answers the ceremony with no allowCredentials; two calls differ only in challenge and id", async () => {
    const one = await post("/passkey/options");
    const two = await post("/passkey/options");
    expect(one.status).toBe(200);
    const a = dataOf(one) as { ceremonyId: string; options: Record<string, unknown> };
    const b = dataOf(two) as { ceremonyId: string; options: Record<string, unknown> };
    expect(a.options["allowCredentials"] ?? []).toEqual([]);
    expect(a.options["userVerification"]).toBe("required");
    expect({ ...a.options, challenge: "x" }).toEqual({ ...b.options, challenge: "x" });
    expect(a.ceremonyId).not.toBe(b.ceremonyId);
  });

  it("POST /passkey/verify refuses a malformed body (400) and an unknown ceremony (the generic 401)", async () => {
    expect((await post("/passkey/verify", { ceremonyId: "short" })).status).toBe(400);
    const res = await post("/passkey/verify", {
      ceremonyId: "A".repeat(43),
      credential: {
        id: "abc",
        rawId: "abc",
        type: "public-key",
        response: { clientDataJSON: "e30", authenticatorData: "AAAA", signature: "AAAA" },
      },
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: "Invalid credentials" });
  });
});

describe("the success answers of the passkey and invitation routes", () => {
  it("a verified passkey answers exactly as POST /auth/login does (token, refreshToken, session at the top level)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the service module the controller calls
    const passkey = require("../../services/passkeyLogin.service") as { verifyPasskeyLogin: () => Promise<unknown> };
    jest.spyOn(passkey, "verifyPasskeyLogin").mockResolvedValue({
      data: { id: "u1" },
      token: "access",
      refreshToken: "refresh",
      session: { id: "s1", expiredAt: "2026-10-07T00:00:00.000Z" },
    });
    const res = await post("/passkey/verify", {
      ceremonyId: "A".repeat(43),
      credential: { id: "a", rawId: "a", type: "public-key", response: { clientDataJSON: "a", authenticatorData: "a", signature: "a" } },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Login successful", data: { id: "u1" }, token: "access", refreshToken: "refresh" });
  });

  it("an accepted invitation answers 200 with no data", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the service module the controller calls
    const invitation = require("../../services/invitation.service") as { acceptInvitation: () => Promise<void> };
    jest.spyOn(invitation, "acceptInvitation").mockResolvedValue(undefined);
    const res = await post("/invitation/accept", { token: "A".repeat(43), password: "Str0ngPassw0rd" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Invitation accepted", data: null });
  });
});

// ============================================================================
describe("P10-15 — POST /auth/invitation/accept", () => {
  it("a token that names nothing is the ONE 400; a weak password is a 400 about its shape", async () => {
    const bad = await post("/invitation/accept", { token: "A".repeat(43), password: "Str0ngPassw0rd" });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ message: "This invitation link is invalid or has expired" });
    const weak = await post("/invitation/accept", { token: "A".repeat(43), password: "weak" });
    expect(weak.status).toBe(400);
    expect(weak.body).not.toMatchObject({ message: "This invitation link is invalid or has expired" });
  });
});
