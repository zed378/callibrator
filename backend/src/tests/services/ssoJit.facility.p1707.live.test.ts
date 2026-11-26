/** PT-21: real JIT provisioning, pending refusal and audit rollback on PostgreSQL, no mocks. */
import type { Sequelize } from "sequelize";
import type * as Models from "../../models";
import type * as Context from "../../middlewares/tenantContext.middleware";
import type * as Boot from "../fixtures/liveBoot";
import type * as Sso from "../../services/sso.service";
import type * as Binding from "../../services/userFacilityBinding.service";
import type * as Oidc from "../../services/oidcJwks";
import { facilityRefusalOf } from "../../utils/facilityRefusal.util";
import { ROLE_IDS } from "../../constants/roleConstants";
import { environment } from "../../config/env";
import { seedSql } from "../fixtures/ipmLive";
import { LIVE_BOOT_TIMEOUT_MS } from "../fixtures/disposableDatabase";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { sign } from "jsonwebtoken";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type * as Controller from "../../controllers/sso.controller";
import type * as Auth from "../../middlewares/auth.middleware";
import type { TenantId } from "../../types/ids";

const T1 = "c1707210-0000-4000-8000-000000000001";
const T2 = "c1707210-0000-4000-8000-000000000002";
const T3 = "c1707210-0000-4000-8000-000000000003";
const ADMIN = "c1707210-0000-4000-8000-0000000000a1";
interface Graph {
  db: Sequelize;
  models: typeof Models;
  storage: typeof Context.tenantStorage;
  boot: typeof Boot;
  sso: typeof Sso;
  binding: typeof Binding;
  migrator: Parameters<typeof Boot.bootSchema>[1];
}
/* eslint-disable @typescript-eslint/no-require-imports -- load one graph after scratch database selection */
const load = (): Graph => ({
  db: (require("../../config") as { db: Sequelize }).db,
  models: require("../../models") as typeof Models,
  storage: (require("../../middlewares/tenantContext.middleware") as typeof Context).tenantStorage,
  boot: require("../fixtures/liveBoot") as typeof Boot,
  sso: require("../../services/sso.service") as typeof Sso,
  binding: require("../../services/userFacilityBinding.service") as typeof Binding,
  migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
});
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P17-07 PT-21 SSO JIT persistence on PostgreSQL as callibrator_app", () => {
  let g: Graph;
  const identity = (tag: string) => ({ email: `${tag}@p1707.example.test`, firstName: "Synthetic", lastName: tag });
  beforeAll(async () => {
    environment()["FACILITY_BINDING_ENABLED"] = "true";
    g = load();
    await g.boot.bootSchema(g.db as unknown as Parameters<typeof Boot.bootSchema>[0], g.migrator);
    for (const [tenant, role, users, facilities, tag] of [
      [T1, "c1707210-0000-4000-8000-0000000000b1", [ADMIN], [["c1707210-0000-4000-8000-0000000000f1", "JIT-F1"]], "jitmulti"],
      [T2, "c1707210-0000-4000-8000-0000000000b2", [], [], "jitself"],
      [T3, "c1707210-0000-4000-8000-0000000000b3", [], [], "jitrollback"],
    ] as const) {
      for (const statement of seedSql({ tenant, role, users, facilities, devices: [], tag })) {await g.db.query(statement);}
    }
    await g.db.query("INSERT INTO client_facilities (id,tenant_id,name,code,kind,is_self,created_at,updated_at) VALUES ('c1707210-0000-4000-8000-0000000000f2',$1,'JIT self','SELF','hospital',true,now(),now())", { bind: [T2] });
    await g.db.query("INSERT INTO roles (id,name,created_at,updated_at) VALUES ($1,'USER',now(),now()) ON CONFLICT (id) DO NOTHING", { bind: [ROLE_IDS.USER] });
    // An independent database failure proves the audit and user mutation share one transaction.
    await g.db.query(`CREATE FUNCTION public.p1707_refuse_jit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${T3}' AND NEW.changes->>'operation'='SSO_JIT_PROVISION' THEN RAISE EXCEPTION 'synthetic audit refusal'; END IF; RETURN NEW; END $$`);
    await g.db.query("CREATE TRIGGER p1707_refuse_jit_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.p1707_refuse_jit_audit()");
    await g.boot.enterAppRole(g.db);
  }, LIVE_BOOT_TIMEOUT_MS);
  afterAll(async () => { delete environment()["FACILITY_BINDING_ENABLED"]; await g.db.close(); });

  it("creates a pending default-role identity with one audit, refuses it, and re-login cannot clear pending", async () => {
    const user = await g.sso.provisionUser(T1 as TenantId, identity("pending"));
    expect(user).toMatchObject({ tenantId: T1, status: "ACTIVE", clientFacilityId: null, facilityBindingPending: true, roleId: ROLE_IDS.USER });
    expect(facilityRefusalOf(user)).toMatchObject({ code: "FACILITY_BINDING_PENDING" });
    expect(await g.models.AuditLog.count({ where: { tenantId: T1, resourceId: user.id, action: "CREATE" } })).toBe(1);
    const again = await g.sso.provisionUser(T1 as TenantId, identity("pending"));
    expect(again.id).toBe(user.id);
    expect(facilityRefusalOf(again)).toMatchObject({ code: "FACILITY_BINDING_PENDING" });
    expect(await g.models.AuditLog.count({ where: { tenantId: T1, resourceId: user.id, action: "CREATE" } })).toBe(1);
  });

  it("only the administrator confirmation clears pending; self-only tenant is an independent positive control", async () => {
    const pending = await g.sso.provisionUser(T1 as TenantId, identity("confirmed"));
    await g.storage.run({ tenantId: T1 as TenantId, userId: ADMIN, facilityBound: false, isSuperAdmin: false, isSystemTask: false }, () =>
      g.binding.setBinding(T1 as TenantId, { userId: pending.id, clientFacilityId: null, roleId: ROLE_IDS.USER, reason: "Synthetic PT21 administrator confirmation" }, { userId: ADMIN }));
    const confirmed = await g.sso.provisionUser(T1 as TenantId, identity("confirmed"));
    expect(confirmed.facilityBindingPending).toBe(false);
    expect(facilityRefusalOf(confirmed)).toBeNull();
    const self = await g.sso.provisionUser(T2 as TenantId, identity("self"));
    expect(self.facilityBindingPending).toBe(false);
    expect(facilityRefusalOf(self)).toBeNull();
  });

  it("audit insertion failure rolls back the new JIT user entirely", async () => {
    await expect(g.sso.provisionUser(T3 as TenantId, identity("rollback"))).rejects.toMatchObject({ status: 500 });
    expect(await g.models.Users.count({ where: { tenantId: T3, email: identity("rollback").email } })).toBe(0);
    expect(await g.models.AuditLog.count({ where: { tenantId: T3 } })).toBe(0);
  });

  it("exchanges an actual IdP code with PKCE/JWKS, keeps JIT pending, and refuses nonce, verifier and code replay attacks", async () => {
    // Test-mode only: production deliberately ignores this documented local-provider allow-list.
    const previous = environment()["SSRF_DEV_ALLOW_HOSTS"];
    environment()["SSRF_DEV_ALLOW_HOSTS"] = "127.0.0.1";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "p1707-local", alg: "RS256", use: "sig" };
    const grants = new Map<string, { nonce: string; challenge: string; redirect: string }>();
    let issuer = "";
    let exchanges = 0;
    const provider = createServer((req, res) => {
      const url = new URL(req.url ?? "/", issuer);
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
      } else if (url.pathname === "/jwks") {
        json(200, { keys: [jwk] });
      } else if (url.pathname === "/authorize") {
        const p = url.searchParams;
        if (p.get("client_id") !== "p1707-client" || p.get("code_challenge_method") !== "S256") {
          json(400, { error: "invalid_request" });
          return;
        }
        const code = randomBytes(24).toString("hex");
        grants.set(code, { nonce: p.get("nonce") ?? "", challenge: p.get("code_challenge") ?? "", redirect: p.get("redirect_uri") ?? "" });
        const target = new URL(p.get("redirect_uri") ?? "");
        target.searchParams.set("code", code);
        target.searchParams.set("state", p.get("state") ?? "");
        res.writeHead(302, { Location: target.toString() });
        res.end();
      } else if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          const p = new URLSearchParams(body);
          const code = p.get("code") ?? "";
          const grant = grants.get(code);
          grants.delete(code);
          const challenge = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
          if (challenge !== grant?.challenge || p.get("redirect_uri") !== grant.redirect || p.get("client_id") !== "p1707-client" || p.get("grant_type") !== "authorization_code") {
            json(400, { error: "invalid_grant" });
            return;
          }
          exchanges++;
          json(200, { id_token: sign({ nonce: grant.nonce, email: "oidc-wire@p1707.example.test", given_name: "Synthetic", family_name: "Wire" }, privateKey, { algorithm: "RS256", keyid: "p1707-local", issuer, audience: "p1707-client", subject: "synthetic-oidc-wire", expiresIn: 60 }) });
        });
      } else { json(404, { error: "not_found" }); }
    });
    try {
      await new Promise<void>((resolve) => { provider.listen(0, "127.0.0.1", resolve); });
      const address = provider.address();
      if (!address || typeof address === "string") { throw new Error("IdP did not bind a TCP port"); }
      issuer = `http://127.0.0.1:${String(address.port)}`;
      const settings = { oidc_authority: issuer, oidc_client_id: "p1707-client" };
      // No transport, verifier, database, or provisioning mocks.
      const oidc = require("../../services/oidcJwks") as typeof Oidc; // eslint-disable-line @typescript-eslint/no-require-imports
      const metadata = await oidc.discover(settings);
      const redirectUri = "http://127.0.0.1/callback";
      const verifier = randomBytes(32).toString("base64url");
      const nonce = randomBytes(24).toString("hex");
      const authorize = async (): Promise<string> => {
        const url = g.sso.generateOidcAuthRequest("synthetic", settings, { state: "independent-state", nonce, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), redirectUri, authorizationEndpoint: metadata.authorizationEndpoint });
        const reply = await fetch(url, { redirect: "manual" });
        expect(reply.status).toBe(302);
        const callback = new URL(reply.headers.get("location") ?? "");
        expect(callback.searchParams.get("state")).toBe("independent-state");
        return callback.searchParams.get("code") ?? "";
      };
      const code = await authorize();
      const identity = await g.sso.verifyOidcCallback(code, settings, redirectUri, { nonce, codeVerifier: verifier });
      expect(identity.email).toBe("oidc-wire@p1707.example.test");
      const user = await g.sso.provisionUser(T1 as TenantId, identity);
      expect(facilityRefusalOf(user)).toMatchObject({ code: "FACILITY_BINDING_PENDING" });
      expect(await g.models.AuditLog.count({ where: { tenantId: T1, resourceId: user.id, action: "CREATE" } })).toBe(1);
      await expect(g.sso.verifyOidcCallback(code, settings, redirectUri, { nonce, codeVerifier: verifier })).rejects.toMatchObject({ status: 401 });
      await expect(g.sso.verifyOidcCallback(await authorize(), settings, redirectUri, { nonce: "wrong-nonce", codeVerifier: verifier })).rejects.toMatchObject({ status: 401 });
      await expect(g.sso.verifyOidcCallback(await authorize(), settings, redirectUri, { nonce, codeVerifier: "wrong-verifier" })).rejects.toMatchObject({ status: 401 });
      expect(exchanges).toBe(2);
      expect(await g.models.Users.count({ where: { tenantId: T1, email: identity.email } })).toBe(1);

      // The HTTP boundary uses the real controller, session service and auth middleware.
      const controller = require("../../controllers/sso.controller") as typeof Controller; // eslint-disable-line @typescript-eslint/no-require-imports
      const { auth } = require("../../middlewares/auth.middleware") as typeof Auth; // eslint-disable-line @typescript-eslint/no-require-imports
      const app = express();
      app.use(express.json());
      app.post("/login", controller.oidcLogin);
      app.get("/callback/:tenantCode", controller.oidcCallback);
      app.post("/exchange", controller.ssoExchange);
      app.get("/protected", auth, (_req, res) => { res.json({ reached: true }); });
      const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
        if (res.headersSent) { next(error); return; }
        const failure = error as { status?: number; message?: string };
        res.status(failure.status ?? 500).json({ message: failure.message });
      };
      app.use(errors);
      const server = app.listen(0, "127.0.0.1");
      try {
        await new Promise<void>((resolve) => { server.once("listening", resolve); });
        const bound = server.address();
        if (!bound || typeof bound === "string") { throw new Error("Controller did not bind a TCP port"); }
        const base = `http://127.0.0.1:${String(bound.port)}`;
        const tenantCode = "pt21controller";
        await g.models.Tenants.update({ code: tenantCode, settings: { sso_enabled: true, ...settings, oidc_redirect_uri: `${base}/callback/${tenantCode}` } }, { where: { id: T1 } });
        const start = async (): Promise<{ cookie: string; callback: string }> => {
          const response = await fetch(`${base}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantCode }) });
          expect(response.status).toBe(200);
          const cookie = response.headers.get("set-cookie") ?? "";
          expect(cookie).toContain("HttpOnly");
          expect(cookie).toContain("SameSite=Lax");
          expect(cookie).toContain("Path=/api/v1/auth/sso/oidc");
          const body = await response.json() as { data: { redirectUrl: string } };
          const authorizeResponse = await fetch(body.data.redirectUrl, { redirect: "manual" });
          expect(authorizeResponse.status).toBe(302);
          return { cookie: cookie.split(";")[0] ?? "", callback: authorizeResponse.headers.get("location") ?? "" };
        };
        const stolen = await start();
        const beforeAttack = exchanges;
        const refused = await fetch(stolen.callback, { redirect: "manual" });
        expect(refused.status).toBe(302);
        expect(new URL(refused.headers.get("location") ?? "").searchParams.get("error")).toBe("sso_state");
        expect(exchanges).toBe(beforeAttack);
        const replayState = await fetch(stolen.callback, { headers: { Cookie: stolen.cookie }, redirect: "manual" });
        expect(new URL(replayState.headers.get("location") ?? "").searchParams.get("error")).toBe("sso_state");
        const legitimate = await start();
        const callbackResponse = await fetch(legitimate.callback, { headers: { Cookie: legitimate.cookie }, redirect: "manual" });
        expect(callbackResponse.status).toBe(302);
        const handoff = new URL(callbackResponse.headers.get("location") ?? "");
        expect(handoff.pathname).toBe("/sso-callback");
        expect([...handoff.searchParams.keys()]).toEqual(["code"]);
        const handoffCode = handoff.searchParams.get("code");
        expect(handoffCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const exchange = (): Promise<globalThis.Response> => fetch(`${base}/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: handoffCode }) });
        const sessionResponse = await exchange();
        expect(sessionResponse.status).toBe(200);
        const session = await sessionResponse.json() as { token: string; session: { id: string } };
        expect(session.token).toEqual(expect.any(String));
        expect(await g.models.AuditLog.count({ where: { tenantId: T1, resourceId: session.session.id, action: "LOGIN" } })).toBe(1);
        expect((await exchange()).status).toBe(401);
        const protectedResponse = await fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${session.token}` } });
        expect(protectedResponse.status).toBe(403);
        expect(await protectedResponse.json()).toMatchObject({ code: "FACILITY_BINDING_PENDING" });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) { reject(error); } else { resolve(); } }); });
      }
    } finally {
      provider.closeAllConnections();
      await new Promise<void>((resolve, reject) => { provider.close((error) => { if (error) { reject(error); } else { resolve(); } }); });
      if (previous === undefined) { delete environment()["SSRF_DEV_ALLOW_HOSTS"]; } else { environment()["SSRF_DEV_ALLOW_HOSTS"] = previous; }
    }
  });
});
