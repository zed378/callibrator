/**
 * P9-21 / P9-25 (ADR-103) — the contract of `oidc.route.ts`, code-first.
 *
 * Callibrator as an OpenID Connect PROVIDER. index.js mounts this router
 * twice: at `/api/v1/oidc` (documented here) and at `/oidc`, the issuer-root
 * path the discovery document advertises to relying parties; the `/oidc`
 * copies are the same handlers, published there too (`alsoMountedAt`, P9-18;
 * they were on the P9-25 pinned list while a module documented one mount).
 *
 * Five routes are PUBLIC, registered before `router.use(auth)`: discovery,
 * JWKS, authorize (a browser redirect to the consent screen), token (client
 * secret or PKCE) and userinfo (a Bearer access token). They answer the OAuth
 * / OIDC shapes, not the house envelope. The consent screen's two routes are
 * the signed-in user's own decision (no gate). Client management is super
 * admin only, except the home-tenant list (`oidc: read`). The client body is
 * `oidcClientSchema` (`@callibrator/contracts/oidc`), checked in the
 * controller. Examples are synthetic.
 */
import { z } from "zod";
import { oidcClientSchema } from "../../validators/oidc.validator";
import { tenantIdParams } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "superAdminOnly" } as const;
const ownDecision = {
  kind: "authenticated",
  reason: "the signed-in user's own consent decision (A-275: only the client tenant's users may approve)",
} as const;

const clientParams = z.object({
  clientId: z.string().meta({ description: "The client id", example: "cbc_3f2e1d0c9b8a7f6e" }),
});
const tenantClientParams = tenantIdParams.extend(clientParams.shape);

const client = z
  .object({
    clientId: z.string(),
    name: z.string().optional(),
    redirectUris: z.array(z.string()).optional(),
    scopes: z.array(z.string()).optional(),
    grantTypes: z.array(z.string()).optional(),
    createdAt: z.iso.datetime().optional(),
  })
  .meta({ id: "OidcClient", description: "A registered relying party (never its secret)" });

const registered = z.object({
  clientId: z.string(),
  clientSecret: z.string().meta({ description: "Shown once; only its hash is kept" }),
  name: z.string().optional(),
  redirectUris: z.array(z.string()),
  scopes: z.array(z.string()),
  grantTypes: z.array(z.string()),
});
const rotated = z.object({ clientId: z.string(), clientSecret: z.string().meta({ description: "The new secret, shown once" }) });

/** An OAuth 2.0 error (RFC 6749 §5.2), as the token and userinfo endpoints answer it. */
const oauthError = z.object({ error: z.string(), error_description: z.string().optional() });
const oauthErrors = {
  400: { description: "An OAuth error (RFC 6749 §5.2)", body: oauthError, example: { error: "invalid_grant", error_description: "Authorization code expired" } },
  401: { description: "An OAuth error: the client or the token is not valid", body: oauthError, example: { error: "invalid_token" } },
} as const;

const tokenBody = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]).meta({ description: "Any other value is `unsupported_grant_type`" }),
  code: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional().meta({ description: "PKCE" }),
  refresh_token: z.string().optional(),
});

export default defineRouteDocs({
  router: "api/oidc.route",
  mount: "/api/v1/oidc",
  alsoMountedAt: [{ mount: "/oidc", operationIdSuffix: "AtIssuerRoot" }],
  tag: "OIDC Provider",
  tagDescription:
    "Callibrator as an OpenID Connect provider for relying parties. The same router is served at `/oidc` (the issuer-root " +
    "path in the discovery document).",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/.well-known/openid-configuration",
      operationId: "oidcDiscovery",
      summary: "Discovery metadata (public)",
      permission: null,
      audited: false,
      success: {
        status: 200,
        description: "The OpenID Provider metadata (bare JSON)",
        body: z.looseObject({
          issuer: z.string(),
          authorization_endpoint: z.string(),
          token_endpoint: z.string(),
          userinfo_endpoint: z.string(),
          jwks_uri: z.string(),
          scopes_supported: z.array(z.string()),
          response_types_supported: z.array(z.string()),
          subject_types_supported: z.array(z.string()),
          id_token_signing_alg_values_supported: z.array(z.string()),
        }),
      },
    },
    {
      method: "get",
      path: "/.well-known/jwks.json",
      operationId: "oidcJwks",
      summary: "The provider's signing keys (public)",
      permission: null,
      audited: false,
      success: {
        status: 200,
        description: "A JSON Web Key Set (bare JSON)",
        body: z.object({
          keys: z.array(z.object({ kty: z.string(), use: z.literal("sig"), kid: z.string(), alg: z.literal("RS256"), n: z.string(), e: z.string() })),
        }),
      },
    },
    {
      method: "get",
      path: "/authorize",
      operationId: "oidcAuthorize",
      summary: "Authorization endpoint (public)",
      description: "Stages the request and redirects the browser to the consent screen. A bad request is a 400.",
      permission: null,
      audited: false,
      query: z.looseObject({
        client_id: z.string(),
        redirect_uri: z.string(),
        response_type: z.literal("code"),
        scope: z.string().optional(),
        state: z.string().optional(),
        nonce: z.string().optional(),
        code_challenge: z.string().optional(),
        code_challenge_method: z.string().optional(),
      }),
      success: { status: 302, description: "To the consent screen", redirect: true },
    },
    {
      method: "post",
      path: "/token",
      operationId: "oidcToken",
      summary: "Token endpoint (public, client-authenticated)",
      description: "Exchanges an authorization code (client secret or PKCE), or a refresh token, for tokens.",
      permission: null,
      audited: false,
      body: tokenBody,
      success: {
        status: 200,
        description: "The token set (bare JSON)",
        body: z.object({
          access_token: z.string(),
          id_token: z.string(),
          refresh_token: z.string(),
          token_type: z.literal("Bearer"),
          expires_in: z.number().int(),
          scope: z.string(),
        }),
      },
      errorBodies: oauthErrors,
      errors: [401],
    },
    {
      method: "get",
      path: "/userinfo",
      operationId: "oidcUserinfo",
      summary: "UserInfo endpoint (public, Bearer access token)",
      description: "The claims of the access token's user. No or a bad Bearer token is a 401 `invalid_token`.",
      permission: null,
      audited: false,
      success: { status: 200, description: "The claims (bare JSON)", body: z.looseObject({ sub: z.string() }) },
      errorBodies: oauthErrors,
      errors: [401],
    },
    {
      method: "get",
      path: "/authorize/request/:requestId",
      operationId: "oidcGetAuthRequest",
      summary: "Get a staged authorization request (the consent screen)",
      permission: ownDecision,
      audited: false,
      params: z.object({ requestId: z.string().meta({ description: "The staged request's id", example: "a1b2c3d4e5f60718" }) }),
      success: {
        status: 200,
        description: "What the user is asked to approve",
        data: z.object({ clientName: z.string().optional(), scope: z.array(z.string()), redirectUri: z.string() }),
      },
      errorBodies: {
        404: {
          description: "No such request, or not one this user may decide (`success: false` since 2026-10-11, ADR-137; it said `true` before).",
          body: z.object({ success: z.literal(false), status: z.literal(404), message: z.string(), data: z.null() }),
          example: { success: false, status: 404, message: "Authorization request not found", data: null },
        },
      },
    },
    {
      method: "post",
      path: "/authorize/decision",
      operationId: "oidcDecide",
      summary: "Approve or deny an authorization request",
      permission: ownDecision,
      audited: true,
      body: z.object({
        request: z.string().meta({ description: "The staged request's id" }),
        approve: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
      }),
      success: { status: 200, description: "Where the browser goes back to the client", data: z.object({ redirectTo: z.string() }) },
    },
    {
      method: "post",
      path: "/clients",
      operationId: "oidcRegisterClient",
      summary: "Register a client in the operator's home tenant",
      description: "A platform client: only the home tenant's users may approve it (A-275).",
      permission: superAdmin,
      audited: true,
      body: oidcClientSchema,
      success: { status: 200, description: "The client, with its secret (shown once)", data: registered },
    },
    {
      method: "get",
      path: "/clients",
      operationId: "oidcListClients",
      summary: "List the caller's tenant's clients",
      permission: { kind: "dynamicAccess", resource: "oidc", action: "read" },
      audited: false,
      success: { status: 200, description: "The clients", data: z.array(client) },
    },
    {
      method: "post",
      path: "/clients/:clientId/rotate-secret",
      operationId: "oidcRotateSecret",
      summary: "Rotate a home-tenant client's secret",
      permission: superAdmin,
      audited: true,
      params: clientParams,
      success: { status: 200, description: "The new secret", data: rotated },
    },
    {
      method: "delete",
      path: "/clients/:clientId",
      operationId: "oidcDeleteClient",
      summary: "Delete a home-tenant client",
      permission: superAdmin,
      audited: true,
      params: clientParams,
      success: { status: 200, description: "Whether it was deleted", data: z.object({ deleted: z.boolean() }) },
    },
    {
      method: "get",
      path: "/tenants/:tenantId/clients",
      operationId: "oidcListTenantClients",
      summary: "List a named tenant's clients",
      permission: superAdmin,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The clients", data: z.array(client) },
    },
    {
      method: "post",
      path: "/tenants/:tenantId/clients",
      operationId: "oidcRegisterTenantClient",
      summary: "Register a client in a named tenant",
      description: "A-280: a client a hospital's users sign in to lives in the hospital's tenant.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: oidcClientSchema,
      success: { status: 200, description: "The client, with its secret (shown once)", data: registered },
    },
    {
      method: "post",
      path: "/tenants/:tenantId/clients/:clientId/rotate-secret",
      operationId: "oidcRotateTenantClientSecret",
      summary: "Rotate a named tenant's client secret",
      permission: superAdmin,
      audited: true,
      params: tenantClientParams,
      success: { status: 200, description: "The new secret", data: rotated },
    },
    {
      method: "delete",
      path: "/tenants/:tenantId/clients/:clientId",
      operationId: "oidcDeleteTenantClient",
      summary: "Delete a named tenant's client",
      permission: superAdmin,
      audited: true,
      params: tenantClientParams,
      success: { status: 200, description: "Whether it was deleted", data: z.object({ deleted: z.boolean() }) },
    },
  ],
});
