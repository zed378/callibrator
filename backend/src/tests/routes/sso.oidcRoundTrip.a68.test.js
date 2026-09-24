/**
 * A-68 / A-69 — an OIDC sign-in, end to end, against a REAL identity provider
 * running in this process.
 *
 * "A mock proves the client, not the contract." Nothing between the browser and
 * the IdP is mocked here:
 *
 *   - the IdP is an HTTP server on an ephemeral port. It publishes a real RSA
 *     JWKS, issues authorization codes at /authorize, enforces PKCE S256 at
 *     /token (a wrong or missing code_verifier is `invalid_grant`, as RFC 7636
 *     requires of a real IdP), and signs a real RS256 ID token with
 *     jsonwebtoken, carrying the nonce it was sent;
 *   - the backend is the real auth router under Express, with the real
 *     sso.controller, sso.service, oidcJwks (real axios, real JWKS fetch, real
 *     signature check) and the real redis.service — which, with no Redis in a
 *     unit run, answers "not ready", so state and hand-off codes take the
 *     in-process fallback exactly as they would with Redis down;
 *   - the "browser" is fetch with `redirect: "manual"` and a one-cookie jar, so
 *     every hop — and every cookie — is visible.
 *
 * Faked: the tenant row, its settings and JIT provisioning (models need a
 * database). They are the inputs to the flow, not what is under test.
 *
 * What this cannot show: a real IdP's quirks (Entra ID's issuer and JWKS
 * location differ from `${authority}/.well-known/jwks.json`) — see A-68's
 * section in TASKS/AUDIT-2026-09-REMEDIATION.md.
 */

const http = require("http");
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const authRouter = require("../../routes/api/auth.route");
const { errorHandler } = require("../../middlewares/errorHandlers.middleware");
const models = require("../../models");
const tenantService = require("../../services/tenant.service");
const ssoService = require("../../services/sso.service");
const oidcJwks = require("../../services/oidcJwks");

const CLIENT_ID = "callibrator-rp";
const CLIENT_SECRET = "rp-secret";
const TENANT = { id: "33333333-3333-4333-8333-333333333333", code: "acme" };
const USER = { id: "44444444-4444-4444-8444-444444444444", email: "nurse@acme.example.com" };
const FRONTEND = "https://kalibrasi.example.com";

// ---------------------------------------------------------------------------
// The identity provider
// ---------------------------------------------------------------------------

const idpKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "idp-key-1";

const idp = {
  server: null,
  base: "",
  /** code -> what /authorize was asked for */
  codes: new Map(),
  /** every /authorize query, every /token body */
  authorizeRequests: [],
  tokenRequests: [],
  /** when set, the ID token carries this nonce instead of the one it was sent */
  nonceOverride: null,
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
  });

const idpHandler = async (req, res) => {
  const url = new URL(req.url, idp.base);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
    return send(200, {
      keys: [{ ...idpKeys.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }],
    });
  }

  if (req.method === "GET" && url.pathname === "/authorize") {
    const q = Object.fromEntries(url.searchParams);
    idp.authorizeRequests.push(q);
    // The user signs in; the IdP sends the browser back with a code.
    const code = crypto.randomBytes(16).toString("hex");
    idp.codes.set(code, q);
    const back = new URL(q.redirect_uri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.state);
    return send(302, undefined, { Location: back.toString() });
  }

  if (req.method === "POST" && url.pathname === "/token") {
    const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
    idp.tokenRequests.push(body);
    const issued = idp.codes.get(body.code);
    idp.codes.delete(body.code);
    const challengeOk =
      issued &&
      issued.code_challenge_method === "S256" &&
      typeof body.code_verifier === "string" &&
      crypto.createHash("sha256").update(body.code_verifier).digest("base64url") ===
        issued.code_challenge;
    if (
      !issued ||
      !challengeOk ||
      body.client_id !== CLIENT_ID ||
      body.client_secret !== CLIENT_SECRET ||
      body.redirect_uri !== issued.redirect_uri
    ) {
      return send(400, { error: "invalid_grant" });
    }
    const idToken = jwt.sign(
      {
        sub: "idp-user-1",
        email: USER.email,
        given_name: "Nurse",
        family_name: "Acme",
        nonce: idp.nonceOverride || issued.nonce,
      },
      idpKeys.privateKey,
      { algorithm: "RS256", keyid: KID, issuer: idp.base, audience: CLIENT_ID, expiresIn: "5m" },
    );
    return send(200, { access_token: "at", token_type: "Bearer", id_token: idToken });
  }

  return send(404, { error: "not_found" });
};

// ---------------------------------------------------------------------------
// The relying party: the real auth router
// ---------------------------------------------------------------------------

const rp = { server: null, base: "" };

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

const close = (server) => new Promise((resolve) => server.close(resolve));

// ---------------------------------------------------------------------------
// The browser: manual redirects and a cookie jar
// ---------------------------------------------------------------------------

/** name -> value; only what the browser would send to /api/v1/auth/sso/oidc */
let jar;

const storeCookies = (response) => {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";").map((p) => p.trim());
    const at = pair.indexOf("=");
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    const expired = attributes.some((a) => /^expires=Thu, 01 Jan 1970/i.test(a));
    if (expired || value === "") {
      jar.delete(name);
    } else {
      jar.set(name, { value, attributes });
    }
  }
};

const cookieHeader = () =>
  [...jar.entries()].map(([name, { value }]) => `${name}=${value}`).join("; ");

const browserGet = async (url, { withCookies = true } = {}) => {
  const response = await fetch(url, {
    redirect: "manual",
    headers: withCookies && jar.size ? { cookie: cookieHeader() } : {},
  });
  storeCookies(response);
  return response;
};

/** Steps 1–2: start a sign-in on the login page and follow it to the IdP. */
const startSignIn = async () => {
  const started = await fetch(`${rp.base}/api/v1/auth/sso/oidc/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantCode: TENANT.code }),
  });
  storeCookies(started);
  expect(started.status).toBe(200);
  const { data } = await started.json();

  const atIdp = await browserGet(data.redirectUrl);
  expect(atIdp.status).toBe(302);
  return { redirectUrl: data.redirectUrl, callbackUrl: atIdp.headers.get("location") };
};

// ---------------------------------------------------------------------------

beforeAll(async () => {
  idp.server = http.createServer((req, res) => {
    idpHandler(req, res);
  });
  idp.base = await listen(idp.server);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/v1/auth", authRouter);
  app.use(errorHandler);
  rp.server = http.createServer(app);
  rp.base = await listen(rp.server);
});

afterAll(async () => {
  await close(rp.server);
  await close(idp.server);
});

const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

beforeEach(() => {
  jar = new Map();
  idp.codes.clear();
  idp.authorizeRequests.length = 0;
  idp.tokenRequests.length = 0;
  idp.nonceOverride = null;
  oidcJwks.clearCache();
  process.env.FRONTEND_URL = FRONTEND;

  jest
    .spyOn(models.Tenants, "findOne")
    .mockImplementation(async ({ where }) => (where.code === TENANT.code ? TENANT : null));
  jest.spyOn(tenantService, "getTenantSettings").mockResolvedValue({
    data: {
      settings: {
        sso_enabled: "true",
        oidc_client_id: CLIENT_ID,
        oidc_client_secret: CLIENT_SECRET,
        oidc_authority: idp.base,
        oidc_redirect_uri: `${rp.base}/api/v1/auth/sso/oidc/callback/${TENANT.code}`,
      },
    },
  });
  jest.spyOn(ssoService, "provisionUser").mockResolvedValue(USER);
});

afterEach(() => {
  if (ORIGINAL_FRONTEND_URL === undefined) {
    delete process.env.FRONTEND_URL;
  } else {
    process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
  }
});

describe("A-68/A-69: an OIDC sign-in against a real in-process IdP", () => {
  it("completes: state, nonce and PKCE S256 round-trip, and the browser lands on /sso-callback with a one-time code", async () => {
    const { redirectUrl, callbackUrl } = await startSignIn();

    // The authorize request: a state, a nonce and an S256 challenge — and no verifier.
    const authorize = new URL(redirectUrl).searchParams;
    expect(authorize.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorize.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorize.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorize.get("code_challenge_method")).toBe("S256");
    expect(authorize.has("code_verifier")).toBe(false);

    // The binding cookie: httpOnly, Lax, scoped to the OIDC routes.
    const binding = jar.get("sso_oidc_binding");
    expect(binding).toBeDefined();
    expect(binding.attributes).toEqual(
      expect.arrayContaining(["Path=/api/v1/auth/sso/oidc", "HttpOnly", "SameSite=Lax"]),
    );

    // The IdP returns the browser with a GET — the route must exist for GET.
    const done = await browserGet(callbackUrl);
    expect(done.status).toBe(302);
    const landed = new URL(done.headers.get("location"));
    expect(landed.origin + landed.pathname).toBe(`${FRONTEND}/sso-callback`);
    expect(landed.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The IdP saw a verifier whose S256 is the challenge (it answered 200, and
    // it refuses anything else), and the binding cookie is spent.
    expect(idp.tokenRequests).toHaveLength(1);
    expect(
      crypto.createHash("sha256").update(idp.tokenRequests[0].code_verifier).digest("base64url"),
    ).toBe(authorize.get("code_challenge"));
    expect(jar.has("sso_oidc_binding")).toBe(false);
    expect(ssoService.provisionUser).toHaveBeenCalledWith(
      TENANT.id,
      expect.objectContaining({ email: USER.email }),
    );
  });

  it("a callback with a forged state is refused, and the code never reaches the IdP", async () => {
    const { callbackUrl } = await startSignIn();
    const forged = new URL(callbackUrl);
    forged.searchParams.set("state", crypto.randomBytes(32).toString("base64url"));

    const res = await browserGet(forged.toString());

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("Invalid or expired SSO sign-in state");
    expect(idp.tokenRequests).toHaveLength(0);
    expect(ssoService.provisionUser).not.toHaveBeenCalled();
  });

  it("a callback with no state is refused", async () => {
    const { callbackUrl } = await startSignIn();
    const stripped = new URL(callbackUrl);
    stripped.searchParams.delete("state");

    const res = await browserGet(stripped.toString());

    expect(res.status).toBe(400);
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("a replayed callback is refused — the state is single-use", async () => {
    const { callbackUrl } = await startSignIn();
    const cookieAtCallback = cookieHeader();
    expect((await browserGet(callbackUrl)).status).toBe(302);

    // Replay the exact request, cookie included.
    const replay = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: cookieAtCallback },
    });

    expect(replay.status).toBe(401);
    expect(idp.tokenRequests).toHaveLength(1);
  });

  it("login CSRF: the attacker's callback URL opened in the victim's browser is refused", async () => {
    // The attacker starts a sign-in in THEIR browser and stops at the callback.
    const { callbackUrl } = await startSignIn();

    // The victim's browser has no binding cookie — or one of its own.
    jar = new Map();
    const noCookie = await browserGet(callbackUrl, { withCookies: false });
    expect(noCookie.status).toBe(401);

    expect(idp.tokenRequests).toHaveLength(0);
    expect(ssoService.provisionUser).not.toHaveBeenCalled();
  });

  it("a state bound to another browser is refused even when that browser has a binding cookie of its own", async () => {
    const attacker = await startSignIn();
    const attackerJar = jar;

    jar = new Map();
    await startSignIn(); // the victim's own, unfinished, sign-in
    expect(jar.get("sso_oidc_binding").value).not.toBe(attackerJar.get("sso_oidc_binding").value);

    const res = await browserGet(attacker.callbackUrl);

    expect(res.status).toBe(401);
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("an ID token whose nonce does not match the sign-in is refused", async () => {
    idp.nonceOverride = crypto.randomBytes(32).toString("base64url");
    const { callbackUrl } = await startSignIn();

    const res = await browserGet(callbackUrl);

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("id_token nonce does not match the sign-in request");
    // The token WAS obtained (the code and verifier were good) — the nonce is
    // what refused it.
    expect(idp.tokenRequests).toHaveLength(1);
    expect(ssoService.provisionUser).not.toHaveBeenCalled();
  });
});
