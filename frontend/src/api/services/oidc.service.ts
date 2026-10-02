import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * OIDC Provider — this platform acting as an identity provider.
 *
 * The tenant is taken from the caller's JWT, so no tenantId is sent.
 * Backend: src/routes/api/oidc.route.ts (mounted /api/v1/oidc)
 *   GET    /.well-known/openid-configuration   (public)
 *   GET    /.well-known/jwks.json              (public)
 *   POST   /clients                            (super admin)
 *   GET    /clients
 *   POST   /clients/:clientId/rotate-secret    (super admin)
 *   DELETE /clients/:clientId                  (super admin)
 */

// ---------- Types ----------
// P9-25 (ADR-103 item 11): from the contract (backend/src/routes/api/oidc.openapi.ts);
// the names are unchanged.

type O = "/api/v1/oidc";

export type OidcDiscovery = Body<Op<`${O}/.well-known/openid-configuration`, "get">>;
export type Jwks = Body<Op<`${O}/.well-known/jwks.json`, "get">>;
export type JwksKey = Jwks["keys"][number];

/** A registered client, as returned by GET /clients — never includes the secret. */
export type OidcClient = components["schemas"]["OidcClient"];

/** The server defaults `scopes` to ["openid","profile","email"] and `grantTypes` to ["authorization_code"]. */
export type RegisterClientInput = JsonBody<Op<`${O}/clients`, "post">>;

/**
 * Registration response — `clientSecret` is returned in plaintext exactly once
 * and only ever stored hashed. It cannot be retrieved later.
 */
export type OidcClientWithSecret = DataOf<Op<`${O}/clients`, "post">>;

/** The staged authorization request the consent screen renders. */
export type OidcAuthRequest = DataOf<Op<`${O}/authorize/request/{requestId}`, "get">>;

/** A well-known document: its body, not the envelope. */
type Body<Operation> = Operation extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

// ---------- Service ----------

export const oidcService = {
  /** GET /api/v1/oidc/.well-known/openid-configuration */
  // The two well-known documents are standard OIDC bodies, sent with
  // `res.json(...)` and no envelope (oidcProvider.controller discover/jwks) —
  // reading `.data` off them gave undefined, so the Endpoints card never
  // rendered. An enveloped body is still read for compatibility.
  getDiscovery: async (): Promise<OidcDiscovery> => {
    const response: OidcDiscovery | { data: OidcDiscovery } = await typedApi
      .GET("/api/v1/oidc/.well-known/openid-configuration")
      .then(unwrap);
    return "issuer" in response ? response : response.data;
  },

  /** GET /api/v1/oidc/.well-known/jwks.json */
  getJwks: async (): Promise<Jwks> => {
    const response: Jwks | { data: Jwks } = await typedApi.GET("/api/v1/oidc/.well-known/jwks.json").then(unwrap);
    return "keys" in response ? response : response.data;
  },

  /** GET /api/v1/oidc/clients */
  getClients: async (): Promise<OidcClient[]> => {
    const response = await typedApi.GET("/api/v1/oidc/clients").then(unwrap);
    return response.data ?? [];
  },

  /**
   * POST /api/v1/oidc/clients — super admin only.
   * The returned clientSecret is shown once; it is stored hashed.
   */
  registerClient: async (
    input: RegisterClientInput,
  ): Promise<OidcClientWithSecret> => {
    return (await typedApi.POST("/api/v1/oidc/clients", { body: input }).then(unwrap)).data;
  },

  /**
   * POST /api/v1/oidc/clients/:clientId/rotate-secret — super admin only.
   * Invalidates the old secret immediately.
   */
  rotateSecret: async (
    clientId: string,
  ): Promise<DataOf<Op<`${O}/clients/{clientId}/rotate-secret`, "post">>> =>
    (
      await typedApi
        .POST("/api/v1/oidc/clients/{clientId}/rotate-secret", { params: { path: { clientId } } })
        .then(unwrap)
    ).data,

  /** DELETE /api/v1/oidc/clients/:clientId — super admin only. */
  deleteClient: async (clientId: string): Promise<DataOf<Op<`${O}/clients/{clientId}`, "delete">>> =>
    (await typedApi.DELETE("/api/v1/oidc/clients/{clientId}", { params: { path: { clientId } } }).then(unwrap)).data,

  // ---------- Consent (runtime authorization) ----------

  /**
   * GET /api/v1/oidc/authorize/request/:requestId — load the staged request the
   * consent screen renders (client name, requested scopes, redirect URI).
   * Throws (404) when the request has expired or is unknown.
   */
  getAuthRequest: async (requestId: string): Promise<OidcAuthRequest> => {
    // openapi-fetch encodes the path value, as `encodeURIComponent` did.
    return (
      await typedApi
        .GET("/api/v1/oidc/authorize/request/{requestId}", { params: { path: { requestId } } })
        .then(unwrap)
    ).data;
  },

  /**
   * POST /api/v1/oidc/authorize/decision — submit the user's Approve/Deny.
   * Returns the redirect target (with the auth code, or an access_denied error)
   * to send the browser back to the client.
   */
  submitDecision: async (
    requestId: string,
    approve: boolean,
  ): Promise<DataOf<Op<`${O}/authorize/decision`, "post">>> =>
    (await typedApi.POST("/api/v1/oidc/authorize/decision", { body: { request: requestId, approve } }).then(unwrap))
      .data,
};

export default oidcService;
