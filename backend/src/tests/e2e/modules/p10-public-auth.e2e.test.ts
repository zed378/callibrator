/**
 * P10-13 (AC-12) — live: the public sign-in surface of Phase 10 against a
 * RUNNING backend in production mode.
 *
 *  - POST /auth/login/discover   by email DOMAIN only (P10-04): a username or
 *    an unclaimed domain → password; a claimed domain → the SSO redirect, the
 *    SAME for an existing and a non-existent address; public mailbox domains
 *    cannot be claimed, and a domain has one claimant.
 *  - POST /auth/sso/start        one 404 for an unknown code and a tenant
 *    without SSO, identical to the legacy /sso/login refusal (A-292); a
 *    configured tenant → its IdP.
 *  - POST /auth/register         404 in production, the app's own absent-route
 *    answer (P10-12, Q-44).
 *  - forgot / reset              send-otp neutral for known and unknown; the
 *    mailed code resets once; the old password and a reused code are refused.
 *
 * Env: BASE_URL, E2E_OPERATOR_PASSWORD, E2E_MAILPIT_URL (mandatory; the reset
 * code exists only in an email).
 */
import {
  call,
  createUserWithOneTimePassword,
  dataOf,
  envelope,
  stackMode,
  newClientAddress,
  obj,
  operatorSession,
  replaceOneTimePassword,
  resetCodeFor,
  runStamp,
  signIn,
  str,
  strongPassword,
} from "../p10Live";

const stamp = runStamp();
const ssoDomain = `sso-${stamp}.example.com`;
const idpEntryPoint = `https://idp-${stamp}.example.com/saml/sso`;

let operator = "";
let operatorTenantId = "";
const ssoTenant = { id: "", code: `P10SSO${stamp}`.toUpperCase().slice(0, 40) };
const plainTenant = { id: "", code: `P10PLN${stamp}`.toUpperCase().slice(0, 40) };

const discover = async (identifier: string) =>
  call("POST", "/auth/login/discover", { body: { identifier }, from: newClientAddress() });

const createTenant = async (code: string): Promise<string> => {
  const created = await call("POST", "/tenants/create", { token: operator, body: { name: `P10 ${code}`, code, description: "P10-13 live E2E" } });
  if (created.status !== 201) {
    throw new Error(`E2E P10: POST /tenants/create answered ${String(created.status)}`);
  }
  return str(dataOf(created)["id"]);
};

beforeAll(async () => {
  ({ token: operator, tenantId: operatorTenantId } = await operatorSession());
  ssoTenant.id = await createTenant(ssoTenant.code);
  plainTenant.id = await createTenant(plainTenant.code);
  const configured = await call("PATCH", "/tenants/settings", {
    token: operator,
    body: { tenantId: ssoTenant.id, settings: { sso_enabled: "true", sso_idp_entry_point: idpEntryPoint } },
  });
  if (configured.status !== 200) {
    throw new Error(`E2E P10: PATCH /tenants/settings answered ${String(configured.status)}`);
  }
});

describe("P10 identifier-first discovery (live)", () => {
  test("a username, and an email in an unclaimed domain, go to the password step", async () => {
    for (const identifier of [`someone${stamp}`, `someone@unclaimed-${stamp}.example.com`]) {
      const reply = await discover(identifier);
      expect(reply.status).toBe(200);
      expect(dataOf(reply)).toEqual({ next: "password" });
    }
  });

  test("the super admin claims a domain for a tenant; a public mailbox domain and a second claimant are refused", async () => {
    const claim = await call("PUT", `/admin/tenants/${ssoTenant.id}/sso-domains`, { token: operator, body: { domains: [ssoDomain] } });
    expect(claim.status).toBe(200);
    const read = await call("GET", `/admin/tenants/${ssoTenant.id}/sso-domains`, { token: operator });
    expect(JSON.stringify(dataOf(read))).toContain(ssoDomain);

    const publicDomain = await call("PUT", `/admin/tenants/${plainTenant.id}/sso-domains`, { token: operator, body: { domains: ["gmail.com"] } });
    expect(publicDomain.status).toBe(400);
    const second = await call("PUT", `/admin/tenants/${plainTenant.id}/sso-domains`, { token: operator, body: { domains: [ssoDomain] } });
    expect(second.status).toBe(409);
  });

  test("a claimed domain → the tenant's IdP, answered the SAME for an existing and a non-existent address", async () => {
    // An account that EXISTS in the claimed domain, and two addresses that do not.
    const knownAddress = `known-${stamp}@${ssoDomain}`;
    const existing = await createUserWithOneTimePassword(operator, ssoTenant.id, "USER", "ssoknown", knownAddress);
    expect(existing.id).not.toBe("");
    const known = await discover(knownAddress);
    const unknown = await discover(`nobody-${stamp}@${ssoDomain}`);
    const upper = await discover(`NOBODY-${stamp}@${ssoDomain.toUpperCase()}`);
    for (const reply of [known, unknown, upper]) {
      expect(reply.status).toBe(200);
      const data = dataOf(reply);
      expect(data["next"]).toBe("sso");
      const url = new URL(str(data["redirectUrl"]));
      expect(`${url.origin}${url.pathname}`).toBe(idpEntryPoint);
      expect(url.searchParams.get("RelayState")).toBe(ssoTenant.code);
      expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
      expect(Object.keys(data).sort()).toEqual(["next", "redirectUrl"]);
    }
  });

  test("the budget is per client and generous (120 / 15 min): ten lookups from one address all answer 200", async () => {
    const from = newClientAddress();
    for (let i = 0; i < 10; i++) {
      expect((await call("POST", "/auth/login/discover", { body: { identifier: `x${String(i)}@${ssoDomain}` }, from })).status).toBe(200);
    }
  });
});

describe("P10 organisation-code SSO start (live, A-292)", () => {
  test("a configured tenant's code → 200 with its IdP redirect", async () => {
    const reply = await call("POST", "/auth/sso/start", { body: { orgCode: ssoTenant.code }, from: newClientAddress() });
    expect(reply.status).toBe(200);
    expect(str(dataOf(reply)["redirectUrl"]).startsWith(`${idpEntryPoint}?SAMLRequest=`)).toBe(true);
  });

  test("an unknown code and a tenant without SSO get ONE 404, identical to the legacy /sso/login and /sso/oidc/login refusals", async () => {
    const unknown = await call("POST", "/auth/sso/start", { body: { orgCode: `NOPE${stamp}` }, from: newClientAddress() });
    const noSso = await call("POST", "/auth/sso/start", { body: { orgCode: plainTenant.code }, from: newClientAddress() });
    const legacySaml = await call("POST", "/auth/sso/login", { body: { tenantCode: plainTenant.code }, from: newClientAddress() });
    const legacyOidc = await call("POST", "/auth/sso/oidc/login", { body: { tenantCode: `NOPE${stamp}` }, from: newClientAddress() });
    for (const reply of [unknown, noSso, legacySaml, legacyOidc]) {
      expect(reply.status).toBe(404);
      expect(envelope(reply)).toEqual(envelope(unknown));
    }
  });
});

describe("P10 self-registration is off in production (P10-12, Q-44)", () => {
  test("POST /auth/register is the app's own absent-route 404 in production; elsewhere the neutral 202", async () => {
    const register = await call("POST", "/auth/register", {
      body: { firstName: "Reg", lastName: "Istered", username: `reg${stamp}`, email: `reg-${stamp}@example.com`, password: strongPassword("reg") },
      from: newClientAddress(),
    });
    const absent = await call("POST", `/auth/no-such-route-${stamp}`, { body: {}, from: newClientAddress() });
    if ((await stackMode()) === "production") {
      expect(register.status).toBe(404);
      expect(envelope(register)).toEqual(envelope(absent));
    } else {
      // SELF_REGISTRATION_ENABLED defaults on outside production: one neutral answer (P10-12).
      expect(register.status).toBe(202);
    }
  });
});

describe("P10 forgot / reset password (live)", () => {
  const user = { email: "", password: "" };
  let sentAt = 0;

  beforeAll(async () => {
    const created = await createUserWithOneTimePassword(operator, operatorTenantId, "USER", "reset");
    user.email = created.email;
    user.password = strongPassword("before");
    await replaceOneTimePassword(created.email, created.oneTime, user.password);
  });

  test("send-otp answers the same for a known and an unknown address", async () => {
    sentAt = Date.now();
    const known = await call("POST", "/auth/send-otp", { body: { email: user.email }, from: newClientAddress() });
    const unknown = await call("POST", "/auth/send-otp", { body: { email: `nobody-${stamp}@example.com` }, from: newClientAddress() });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(envelope(unknown)).toEqual(envelope(known));
  });

  test("the mailed code resets the password once; a wrong code and a reused code are refused; the old password stops working", async () => {
    const code = await resetCodeFor(user.email, sentAt);
    expect(code).toMatch(/^\d{6}$/);
    const wrongCode = code === "000000" ? "111111" : "000000";
    const newPassword = strongPassword("after");

    const wrong = await call("POST", "/auth/reset-password", { body: { email: user.email, otp: wrongCode, password: newPassword }, from: newClientAddress() });
    expect(wrong.status).toBe(400);
    const unknownAccount = await call("POST", "/auth/reset-password", {
      body: { email: `nobody-${stamp}@example.com`, otp: code, password: newPassword },
      from: newClientAddress(),
    });
    expect(unknownAccount.status).toBe(400);
    expect(envelope(unknownAccount)).toEqual(envelope(wrong));

    const reset = await call("POST", "/auth/reset-password", { body: { email: user.email, otp: code, password: newPassword }, from: newClientAddress() });
    expect(reset.status).toBe(200);

    const reused = await call("POST", "/auth/reset-password", {
      body: { email: user.email, otp: code, password: strongPassword("third") },
      from: newClientAddress(),
    });
    expect(reused.status).toBe(400);
    expect(envelope(reused)).toEqual(envelope(wrong));

    expect((await signIn(user.email, user.password)).status).toBe(401);
    const signedIn = await signIn(user.email, newPassword);
    expect(signedIn.status).toBe(200);
    expect(str(obj(signedIn.body)["token"])).not.toBe("");
  });
});
