import { api } from "../client";

/**
 * OIDC Provider — this platform acting as an identity provider.
 *
 * The tenant is taken from the caller's JWT, so no tenantId is sent.
 * Backend: src/routes/api/oidc.route.js (mounted /api/v1/oidc)
 *   GET    /.well-known/openid-configuration   (public)
 *   GET    /.well-known/jwks.json              (public)
 *   POST   /clients                            (super admin)
 *   GET    /clients
 *   POST   /clients/:clientId/rotate-secret    (super admin)
 *   DELETE /clients/:clientId                  (super admin)
 */

// ---------- Types ----------

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
}

export interface JwksKey {
  kty: string;
  use: string;
  kid: string;
  alg: string;
  n: string;
  e: string;
}

export interface Jwks {
  keys: JwksKey[];
}

/** A registered client, as returned by GET /clients — never includes the secret. */
export interface OidcClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  grantTypes: string[];
  createdAt?: string;
}

export interface RegisterClientInput {
  name: string;
  redirectUris: string[];
  /** Server defaults to ["openid","profile","email"]. */
  scopes?: string[];
  /** Server defaults to ["authorization_code"]. */
  grantTypes?: string[];
}

/**
 * Registration/rotation response — `clientSecret` is returned in plaintext
 * exactly once and only ever stored hashed. It cannot be retrieved later.
 */
export interface OidcClientWithSecret extends OidcClient {
  clientSecret: string;
}

/** The staged authorization request the consent screen renders. */
export interface OidcAuthRequest {
  clientName: string;
  scope: string[];
  redirectUri: string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const oidcService = {
  /** GET /api/v1/oidc/.well-known/openid-configuration */
  getDiscovery: async (): Promise<OidcDiscovery> => {
    const response = await api.get<BackendResponse<OidcDiscovery>>(
      "/api/v1/oidc/.well-known/openid-configuration",
    );
    return response.data;
  },

  /** GET /api/v1/oidc/.well-known/jwks.json */
  getJwks: async (): Promise<Jwks> => {
    const response = await api.get<BackendResponse<Jwks>>(
      "/api/v1/oidc/.well-known/jwks.json",
    );
    return response.data;
  },

  /** GET /api/v1/oidc/clients */
  getClients: async (): Promise<OidcClient[]> => {
    const response =
      await api.get<BackendResponse<OidcClient[]>>("/api/v1/oidc/clients");
    return response.data ?? [];
  },

  /**
   * POST /api/v1/oidc/clients — super admin only.
   * The returned clientSecret is shown once; it is stored hashed.
   */
  registerClient: async (
    input: RegisterClientInput,
  ): Promise<OidcClientWithSecret> => {
    const response = await api.post<BackendResponse<OidcClientWithSecret>>(
      "/api/v1/oidc/clients",
      input,
    );
    return response.data;
  },

  /**
   * POST /api/v1/oidc/clients/:clientId/rotate-secret — super admin only.
   * Invalidates the old secret immediately.
   */
  rotateSecret: async (
    clientId: string,
  ): Promise<{ clientId: string; clientSecret: string }> => {
    const response = await api.post<
      BackendResponse<{ clientId: string; clientSecret: string }>
    >(`/api/v1/oidc/clients/${clientId}/rotate-secret`);
    return response.data;
  },

  /** DELETE /api/v1/oidc/clients/:clientId — super admin only. */
  deleteClient: async (clientId: string): Promise<{ deleted: boolean }> => {
    const response = await api.delete<BackendResponse<{ deleted: boolean }>>(
      `/api/v1/oidc/clients/${clientId}`,
    );
    return response.data;
  },

  // ---------- Consent (runtime authorization) ----------

  /**
   * GET /api/v1/oidc/authorize/request/:requestId — load the staged request the
   * consent screen renders (client name, requested scopes, redirect URI).
   * Throws (404) when the request has expired or is unknown.
   */
  getAuthRequest: async (requestId: string): Promise<OidcAuthRequest> => {
    const response = await api.get<BackendResponse<OidcAuthRequest>>(
      `/api/v1/oidc/authorize/request/${encodeURIComponent(requestId)}`,
    );
    return response.data;
  },

  /**
   * POST /api/v1/oidc/authorize/decision — submit the user's Approve/Deny.
   * Returns the redirect target (with the auth code, or an access_denied error)
   * to send the browser back to the client.
   */
  submitDecision: async (
    requestId: string,
    approve: boolean,
  ): Promise<{ redirectTo: string }> => {
    const response = await api.post<BackendResponse<{ redirectTo: string }>>(
      "/api/v1/oidc/authorize/decision",
      { request: requestId, approve },
    );
    return response.data;
  },
};

export default oidcService;
