/**
 * This server as an OpenID Connect provider: discovery, JWKS, client
 * registration (A-280), the authorization-code flow with PKCE and consent
 * (A-275), the token and refresh grants, and userinfo.
 *
 * P9-12 (ADR-087 Amendment 14): converted from oidcProvider.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned, and
 * the functions that called their siblings through `exports.` call them through
 * that object (`service.`), so a spy on the module still intercepts them.
 */
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { sign, verify } from "jsonwebtoken";
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { AppError } from "../utils/appError.util";
import { db } from "../config";
import auditService from "./audit.service";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import redis from "./redis.service";
import { envOr } from "../config/env";
import type { AuditAction } from "../constants/auditActions";
import type { TokenPayload } from "../types/auth";
import type { TenantId } from "../types/ids";

const { TenantSettings, Users, Tenant } = models;

const OIDC_ISSUER = envOr("OIDC_ISSUER", "http://localhost:5000");
const OIDC_JWKS_KID = envOr("OIDC_JWKS_KID", "callibrator-oidc-key-1");
// Where /oidc/authorize sends the browser to authenticate + consent.
const OIDC_CONSENT_URL =
  envOr("OIDC_CONSENT_URL", "http://localhost:3000/oauth/consent");

// Redis key namespaces for the short-lived authorization-code flow artifacts.
const authReqKey = (id: string): string => `oidc:authreq:${id}`;
const codeKey = (code: string): string => `oidc:code:${code}`;
const refreshKey = (token: string): string => `oidc:refresh:${token}`;
const AUTH_REQUEST_TTL = 600; // 10 min to log in + consent
const AUTH_CODE_TTL = 300; // 5 min to exchange
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days

/** A registered client, as stored (JSON in a TenantSettings row). */
interface ClientRecord {
  clientId?: string;
  clientSecretHash?: string;
  name?: string;
  redirectUris?: string[];
  scopes?: string[];
  grantTypes?: string[];
  createdAt?: string | Date;
  rotatedAt?: Date;
}

/** An /authorize request staged in Redis while the user signs in and consents. */
interface StagedAuthRequest {
  clientId: string;
  clientName: string | undefined;
  tenantId: string;
  redirectUri: string;
  scope: string[];
  state: string | null;
  nonce: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}

/** An authorization code's payload in Redis. */
interface StagedCode {
  clientId: string;
  tenantId: string;
  userId: string;
  redirectUri: string;
  scope: string[];
  nonce: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}

/** A refresh token's payload in Redis. */
interface StagedRefresh {
  tenantId: string;
  userId: string;
  clientId: string | null;
  scope: string;
}

/** Who is acting (the controller's auditActor). */
interface OidcActor {
  userId?: string | null;
  ipAddress?: string | null;
  /** P9-20: widened to what auditActor(req) returns (type-only; written to the audit rows). */
  userAgent?: string | readonly string[] | null;
}

/** The user a token is issued for, as issueTokens reads it. */
interface TokenSubject {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

/** The token-endpoint answer (RFC 6749 names). */
interface TokenSet {
  access_token: string;
  id_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

const b64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** PKCE: verify a code_verifier against a stored challenge (S256 or plain). */
// A-32: the only caller (authenticateClient) calls this only when a challenge
// was stored. The `if (!codeChallenge) return true` that sat here was
// unreachable, hidden from coverage — and fail-OPEN: a future caller that
// forgot the gate would have skipped PKCE. Without it, a missing challenge
// cannot verify.
function verifyPkce(codeVerifier: string | null | undefined, codeChallenge: string, method: string | null): boolean {
  if (!codeVerifier) {return false;}
  const computed =
    method === "plain"
      ? codeVerifier
      : b64url(createHash("sha256").update(codeVerifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * TenantSettings key prefix for clients registered against THIS server's OIDC
 * provider.
 *
 * Deliberately not "oidc_client_": the SSO feature already stores an
 * (encrypted, non-JSON) setting called `oidc_client_secret`, which a
 * `LIKE 'oidc_client_%'` scan picked up and then tried to JSON.parse — 500ing
 * GET /oidc/clients. Note `_` is also a single-char wildcard in SQL LIKE, so
 * the two namespaces could never be separated by escaping alone.
 */
const CLIENT_KEY_PREFIX = "oidc_rp_";
const clientKey = (clientId: string): string => `${CLIENT_KEY_PREFIX}${clientId}`;

function generateRsaKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

const keyPair = generateRsaKeyPair();

const getPublicKey = (): string => keyPair.publicKey;
const getPrivateKey = (): string => keyPair.privateKey;

/** The published JWKS. */
interface Jwks {
  keys: { kty: string | undefined; use: "sig"; kid: string; alg: "RS256"; n: string | undefined; e: string | undefined }[];
}

/**
 * Build the public JWKS.
 *
 * This delegates to Node's own SPKI->JWK export instead of walking the DER by
 * hand. The previous hand-rolled parser had three defects, all fixed here:
 *
 *  1. SECURITY: `new DataView(der.buffer)` ignored `der.byteOffset`. Buffers
 *     under 4KB are slices of Node's shared 64KB pool, so the parser read from
 *     the START OF THE POOL — i.e. whatever unrelated Buffer happened to live
 *     there — and published it as the modulus on the PUBLIC, unauthenticated
 *     /oidc/.well-known/jwks.json endpoint. That leaked adjacent heap memory.
 *  2. `readLen()` returned the NUMBER OF LENGTH BYTES for long-form lengths
 *     rather than the decoded length, so the walk was misaligned anyway.
 *  3. `n`/`e` were hex-encoded; RFC 7517 requires base64url (`e` must be
 *     "AQAB", not "010001"), so no relying party could verify a token.
 *
 * crypto.createPublicKey().export({ format: "jwk" }) returns correctly
 * base64url-encoded { kty, n, e }.
 */
function buildJwks(): Jwks {
  const { kty, n, e } = createPublicKey(getPublicKey())
    .export({ format: "jwk" });

  return {
    keys: [
      {
        kty,
        use: "sig",
        kid: OIDC_JWKS_KID,
        alg: "RS256",
        n,
        e,
      },
    ],
  };
}

function signToken(payload: object, expiresIn: "15m"): string {
  return sign(payload, getPrivateKey(), {
    algorithm: "RS256",
    expiresIn,
    issuer: OIDC_ISSUER,
    keyid: OIDC_JWKS_KID,
  });
}

/** Read a stored client record, tolerating a corrupt or foreign (non-JSON) row. */
function parseClientSetting(setting: { value: string | null }): ClientRecord | null {
  try {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value reads as {}
    const data: unknown = JSON.parse(setting.value || "{}");
    // An object is taken as a client record; its fields are checked where they are read.
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/** The discovery document (/.well-known/openid-configuration). */
interface DiscoveryDocument {
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

const discover = (): DiscoveryDocument => ({
  issuer: OIDC_ISSUER,
  authorization_endpoint: `${OIDC_ISSUER}/oidc/authorize`,
  token_endpoint: `${OIDC_ISSUER}/oidc/token`,
  userinfo_endpoint: `${OIDC_ISSUER}/oidc/userinfo`,
  jwks_uri: `${OIDC_ISSUER}/oidc/.well-known/jwks.json`,
  scopes_supported: ["openid", "profile", "email", "offline_access"],
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
});

const jwks = (): Jwks => buildJwks();

/**
 * A-280 (ADR-094) — a client is registered, rotated and deleted by the
 * platform operator. Each change is recorded twice in the same transaction,
 * as A-165 records every operator change to a tenant: under PLATFORM (the
 * operator's trail, which survives the tenant) and under the client's tenant
 * (whose users sign in to it). No secret reaches the row.
 *
 * @param transaction - the change's transaction
 * @param actor - who, from where
 * @param tenantId - the client's tenant
 * @param action - "CREATE", "UPDATE" or "DELETE"
 * @param clientId - the client
 * @param changes - non-secret fields
 */
const auditClientChange = async (
  transaction: Transaction,
  actor: OidcActor,
  tenantId: string,
  action: AuditAction,
  clientId: string,
  changes: Record<string, unknown>,
): Promise<void> => {
  const entry = {
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means absent */
    userId: actor.userId || null,
    action,
    resourceType: "OidcClient",
    resourceId: clientId,
    changes,
    ipAddress: actor.ipAddress || null,
    userAgent: actor.userAgent || null,
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId }, { transaction });
};

/**
 * A-280 (ADR-094) — the tenant an operator names in the path must exist.
 * The PLATFORM tenant is hidden by the Tenant model's hooks, so it is 404
 * like an id that does not exist.
 *
 * @param tenantId - the tenant named in the path
 * @returns when it exists
 */
const assertTenantExists = async (tenantId: string | null | undefined): Promise<void> => {
  const tenant = tenantId ? await Tenant.findByPk(tenantId) : null;
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }
};

/** registerClient's fields. */
interface ClientRegistration {
  name?: string;
  redirectUris?: string[];
  scopes?: string[];
  grantTypes?: string[];
}

const registerClient = async (
  tenantId: TenantId,
  data: ClientRegistration,
  actor: OidcActor = {},
): Promise<{ clientId: string; clientSecret: string; name: string | undefined; redirectUris: string[]; scopes: string[]; grantTypes: string[] }> => {
  const clientId = randomUUID();
  const clientSecret = randomBytes(32).toString("hex");
  const hashedSecret = createHash("sha256").update(clientSecret).digest("hex");

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty list falls back too */
  const scopes = data.scopes || ["openid", "profile", "email"];
  const grantTypes = data.grantTypes || ["authorization_code"];
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  await db.transaction(async (transaction) => {
    await TenantSettings.upsert(
      {
        tenantId,
        key: clientKey(clientId),
        value: JSON.stringify({
          clientId,
          clientSecretHash: hashedSecret,
          name: data.name,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
          redirectUris: data.redirectUris || [],
          scopes,
          grantTypes,
          createdAt: new Date(),
        }),
      },
      { transaction },
    );
    await auditClientChange(transaction, actor, tenantId, "CREATE", clientId, {
      operation: "OIDC_CLIENT_REGISTER",
      before: {},
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      after: { name: data.name, redirectUris: data.redirectUris || [], scopes, grantTypes },
    });
  });

  // The plaintext secret is returned exactly once; only the hash is stored.
  return {
    clientId,
    clientSecret,
    name: data.name,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    redirectUris: data.redirectUris || [],
    scopes,
    grantTypes,
  };
};

/** A client as the list shows it (no secret hash). */
interface ClientSummary {
  clientId: string | undefined;
  name: string | undefined;
  redirectUris: string[] | undefined;
  scopes: string[] | undefined;
  grantTypes: string[] | undefined;
  createdAt: string | Date | undefined;
}

const getClients = async (tenantId: string): Promise<ClientSummary[]> => {
  const settings = await TenantSettings.findAll({
    where: { tenantId, key: { [Op.like]: `${CLIENT_KEY_PREFIX}%` } },
  });

  return settings
    .map(parseClientSetting)
    // A row without a clientId is not one of ours — skip rather than 500.
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
    .filter((data): data is ClientRecord => Boolean(data && data.clientId))
    .map((data) => ({
      clientId: data.clientId,
      name: data.name,
      redirectUris: data.redirectUris,
      scopes: data.scopes,
      grantTypes: data.grantTypes,
      createdAt: data.createdAt,
    }));
};

const rotateSecret = async (tenantId: string, clientId: string, actor: OidcActor = {}): Promise<{ clientId: string; clientSecret: string }> => {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: clientKey(clientId) },
  });

  if (!setting) {
    throw new AppError(404, "OIDC client not found");
  }

  const newSecret = randomBytes(32).toString("hex");
  const hashedSecret = createHash("sha256").update(newSecret).digest("hex");

  // As built: a corrupt row throws here (500), unlike the list, which skips it.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  const data = JSON.parse(setting.value || "{}") as ClientRecord;
  data.clientSecretHash = hashedSecret;
  const rotatedAt = new Date();
  data.rotatedAt = rotatedAt;

  await db.transaction(async (transaction) => {
    await TenantSettings.update(
      { value: JSON.stringify(data) },
      { where: { tenantId, key: clientKey(clientId) }, transaction },
    );
    await auditClientChange(transaction, actor, tenantId, "UPDATE", clientId, {
      operation: "OIDC_CLIENT_ROTATE_SECRET",
      rotatedAt: rotatedAt.toISOString(),
    });
  });

  return { clientId, clientSecret: newSecret };
};

const deleteClient = async (tenantId: string, clientId: string, actor: OidcActor = {}): Promise<{ deleted: boolean }> =>
  db.transaction(async (transaction) => {
    const deleted = await TenantSettings.destroy({
      where: { tenantId, key: clientKey(clientId) },
      transaction,
    });
    // Nothing deleted is nothing to record.
    if (deleted > 0) {
      await auditClientChange(transaction, actor, tenantId, "DELETE", clientId, {
        operation: "OIDC_CLIENT_DELETE",
      });
    }
    return { deleted: deleted > 0 };
  });

const issueTokens = async (
  tenantId: string,
  user: TokenSubject,
  scopes: string[] = ["openid", "profile", "email"],
  opts: { clientId?: string | null | undefined; nonce?: string | null | undefined } = {},
): Promise<TokenSet> => {
  const scope = scopes.join(" ");
  const accessToken = signToken(
    {
      sub: user.id,
      email: user.email,
      tenant_id: tenantId,
      scope,
      typ: "access",
    },
    "15m",
  );

  // No `iat`/`exp`/`iss` in the payload: signToken already passes
  // expiresIn + issuer, and jsonwebtoken REFUSES to sign when the payload
  // carries its own `exp` alongside options.expiresIn.
  const idToken = signToken(
    {
      sub: user.id,
      email: user.email,
      given_name: user.firstName,
      family_name: user.lastName,
      tenant_id: tenantId,
      scope,
      // `aud` MUST be the relying party's client_id. Fall back to the email
      // only for legacy/internal callers that mint outside the client flow.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      aud: opts.clientId || user.email,
      ...(opts.nonce ? { nonce: opts.nonce } : {}),
    },
    "15m",
  );

  const refreshToken = randomBytes(64).toString("hex");
  // Persist the refresh token so the refresh_token grant can validate + rotate it.
  await redis.set(
    refreshKey(refreshToken),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    { tenantId, userId: user.id, clientId: opts.clientId || null, scope },
    REFRESH_TTL,
  );

  return {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 900,
    scope,
  };
};

const verifySecret = async (tenantId: string, clientId: string, clientSecret: string): Promise<boolean> => {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: clientKey(clientId) },
  });

  if (!setting) {
    return false;
  }

  const data = parseClientSetting(setting);
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!data || !data.clientSecretHash) {
    return false;
  }

  const hashed = Buffer.from(
    createHash("sha256").update(clientSecret).digest("hex"),
    "hex",
  );
  const stored = Buffer.from(data.clientSecretHash, "hex");

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (hashed.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(hashed, stored);
};

// ==========================================================================
// AUTHORIZATION CODE FLOW
// ==========================================================================

/**
 * Look up a registered client by client_id across every tenant. client_id is a
 * globally-unique UUID, so the (tenant_id, key) row is unambiguous.
 */
const findClientByClientId = async (clientId: string | null | undefined): Promise<(ClientRecord & { tenantId: string }) | null> => {
  if (!clientId) {return null;}
  const setting = await TenantSettings.findOne({
    where: { key: clientKey(clientId) },
  });
  if (!setting) {return null;}
  const data = parseClientSetting(setting);
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!data || !data.clientId) {return null;}
  return { ...data, tenantId: setting.tenantId };
};

/** /authorize's query parameters (RFC 6749 / 7636 names). */
interface AuthorizeParams {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

/**
 * Validate an /authorize request and stage it in Redis. Returns the consent URL
 * to send the browser to. HARD failures (unknown client / unregistered
 * redirect_uri / bad response_type) throw — we must NEVER redirect to an
 * unvalidated redirect_uri, and must not leak them via the error channel.
 */
const beginAuthorization = async (params: AuthorizeParams): Promise<{ requestId: string; consentUrl: string }> => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    nonce,
    code_challenge,
    code_challenge_method,
  } = params;

  const client = await service.findClientByClientId(client_id);
  if (!client) {
    throw new AppError(400, "Unknown client_id");
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  if (!redirect_uri || !(client.redirectUris || []).includes(redirect_uri)) {
    throw new AppError(400, "redirect_uri is not registered for this client");
  }
  if (response_type !== "code") {
    throw new AppError(400, "Only response_type=code is supported");
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" falls back too
  const method = code_challenge_method || (code_challenge ? "S256" : null);
  if (code_challenge && !["S256", "plain"].includes(method as string)) {
    throw new AppError(400, "Unsupported code_challenge_method");
  }

  const requestId = b64url(randomBytes(24));
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  const requestedScope = (scope || "openid").split(/\s+/).filter(Boolean);
  const staged: StagedAuthRequest = {
    // A found client carries its clientId (findClientByClientId checked it).
    clientId: client.clientId as string,
    clientName: client.name,
    tenantId: client.tenantId,
    redirectUri: redirect_uri,
    scope: requestedScope,
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means none */
    state: state || null,
    nonce: nonce || null,
    codeChallenge: code_challenge || null,
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    codeChallengeMethod: code_challenge ? method : null,
  };
  await redis.set(
    authReqKey(requestId),
    staged,
    AUTH_REQUEST_TTL,
  );

  return {
    requestId,
    consentUrl: `${OIDC_CONSENT_URL}?request=${encodeURIComponent(requestId)}`,
  };
};

/** The signed-in user deciding a request (only the home tenant is read). */
interface DecidingUser {
  id?: string;
  tenantId?: string | null;
}

/**
 * A-275 (ADR-094) — the staged request, if `user` may decide it.
 *
 * A request belongs to its client's tenant, and only a signed-in user OF THAT
 * TENANT may see or decide it: the code it mints names the user as `sub` and
 * the client's tenant as `tenant_id`, so any other user would be vouched for
 * by a tenant they do not belong to. A platform client lives in the
 * operator's home tenant, so the operator decides it by the same rule. The
 * home tenant is `user.tenantId`, never the super admin's x-tenant-id
 * override: the tokens are about the account, not the tenant it is viewing.
 *
 * Missing, expired and another tenant's are the same answer (null, then 404),
 * so a request id is no oracle for which tenant's client staged it.
 *
 * @param requestId - the staged request's id
 * @param user - the signed-in user
 * @returns the request, or null
 */
const loadDecidableRequest = async (
  requestId: string | null | undefined,
  user: DecidingUser | null | undefined,
): Promise<StagedAuthRequest | null> => {
  // What beginAuthorization staged under this key.
  const req = (requestId ? await redis.get(authReqKey(requestId)) : null) as StagedAuthRequest | null;
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!req || !user || !user.tenantId || req.tenantId !== user.tenantId) {
    return null;
  }
  return req;
};

/** The one answer for a request the caller may not decide, or that does not exist. */
const AUTH_REQUEST_NOT_FOUND = "Authorization request not found";

/** The consent screen reads the staged request to show the client + scopes. */
const getAuthRequest = async (
  requestId: string | null | undefined,
  user: DecidingUser | null | undefined,
): Promise<{ clientName: string | undefined; scope: string[]; redirectUri: string } | null> => {
  const req = await loadDecidableRequest(requestId, user);
  if (!req) {return null;}
  return {
    clientName: req.clientName,
    scope: req.scope,
    redirectUri: req.redirectUri,
  };
};

/**
 * The authenticated user's consent decision. `approve` mints a single-use code
 * bound to {client, user, redirect, scope, nonce, PKCE}; returns the redirect
 * target (with the code, or an access_denied error).
 */
const decideAuthorization = async (
  requestId: string,
  user: DecidingUser,
  approve: unknown,
  actor: OidcActor = {},
): Promise<{ redirectTo: string }> => {
  // A-275: another tenant's request is left staged for its own users; the
  // caller learns nothing and consumes nothing.
  const req = await loadDecidableRequest(requestId, user);
  if (!req) {
    throw new AppError(404, AUTH_REQUEST_NOT_FOUND);
  }
  await redis.del(authReqKey(requestId));

  const params = new URLSearchParams();
  if (req.state) {
    params.set("state", req.state);
  }

  // A-275: the decision is recorded in the client's tenant (the user's own).
  // The code is minted inside the audit row's transaction: a failed row rolls
  // back before any code exists, and a failed code write rolls the row back.
  const audit = (transaction: Transaction): Promise<unknown> =>
    auditService.logAction(
      {
        tenantId: req.tenantId,
        userId: user.id,
        action: approve ? "APPROVE" : "UPDATE",
        resourceType: "OidcClient",
        resourceId: req.clientId,
        changes: {
          operation: "OIDC_AUTHORIZATION_DECISION",
          outcome: approve ? "approved" : "denied",
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
          clientName: req.clientName || null,
          redirectUri: req.redirectUri,
          scope: req.scope,
        },
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means absent */
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      },
      { transaction },
    );

  if (!approve) {
    await db.transaction(audit);
    params.set("error", "access_denied");
    return { redirectTo: `${req.redirectUri}?${params.toString()}` };
  }

  const code = b64url(randomBytes(32));
  await db.transaction(async (transaction) => {
    await audit(transaction);
    // redis.set answers false rather than throwing; an unstored code would be
    // an approval on record that no client can redeem.
    const staged: StagedCode = {
      clientId: req.clientId,
      tenantId: req.tenantId,
      // A decidable request has a signed-in user.
      userId: user.id as string,
      redirectUri: req.redirectUri,
      scope: req.scope,
      nonce: req.nonce,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: req.codeChallengeMethod,
    };
    const stored = await redis.set(
      codeKey(code),
      staged,
      AUTH_CODE_TTL,
    );
    if (!stored) {
      throw new AppError(
        503,
        "The authorization could not be completed. Return to the application and sign in again.",
      );
    }
  });

  params.set("code", code);
  return { redirectTo: `${req.redirectUri}?${params.toString()}` };
};

/** What a client presents at the token endpoint. */
interface ClientCredentials {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  codeVerifier?: string | undefined;
}

/** Authenticate a client at the token endpoint: PKCE code_verifier OR client_secret. */
async function authenticateClient(codeData: StagedCode, { clientId, clientSecret, codeVerifier }: ClientCredentials): Promise<boolean> {
  if (codeData.clientId !== clientId) {
    return false;
  }
  if (codeData.codeChallenge) {
    return verifyPkce(codeVerifier, codeData.codeChallenge, codeData.codeChallengeMethod);
  }
  // No PKCE ⇒ a confidential client must present its secret.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  return service.verifySecret(codeData.tenantId, clientId, clientSecret || "");
}

/** Token endpoint — authorization_code grant. */
const exchangeAuthorizationCode = async ({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
}: ClientCredentials & { code?: string | undefined; redirectUri?: string | undefined }): Promise<TokenSet> => {
  // What decideAuthorization staged under this key.
  const codeData = (code ? await redis.get(codeKey(code)) : null) as StagedCode | null;
  if (!codeData) {
    throw new AppError(400, "invalid_grant: code is invalid or expired");
  }
  // A code was found, so one was given.
  await redis.del(codeKey(code as string)); // single-use

  if (redirectUri !== codeData.redirectUri) {
    throw new AppError(400, "invalid_grant: redirect_uri mismatch");
  }
  const ok = await authenticateClient(codeData, { clientId, clientSecret, codeVerifier });
  if (!ok) {
    throw new AppError(401, "invalid_client");
  }

  const user = await Users.findByPk(codeData.userId);
  if (!user) {
    throw new AppError(400, "invalid_grant: user no longer exists");
  }

  return service.issueTokens(codeData.tenantId, user, codeData.scope, {
    clientId,
    nonce: codeData.nonce,
  });
};

/** Token endpoint — refresh_token grant (rotates the refresh token). */
const refreshAccessToken = async ({
  refreshToken,
  clientId,
  clientSecret,
}: {
  refreshToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}): Promise<TokenSet> => {
  // What issueTokens stored under this key.
  const data = (refreshToken ? await redis.get(refreshKey(refreshToken)) : null) as StagedRefresh | null;
  if (!data) {
    throw new AppError(400, "invalid_grant: refresh token is invalid or expired");
  }
  if (data.clientId !== clientId) {
    throw new AppError(401, "invalid_client");
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  const ok = await service.verifySecret(data.tenantId, clientId, clientSecret || "");
  if (!ok) {
    throw new AppError(401, "invalid_client");
  }

  await redis.del(refreshKey(refreshToken as string)); // rotate
  const user = await Users.findByPk(data.userId);
  if (!user) {
    throw new AppError(400, "invalid_grant: user no longer exists");
  }

  return service.issueTokens(data.tenantId, user, data.scope.split(" "), { clientId });
};

/** Userinfo endpoint — verify the access-token JWT and return scoped claims. */
const getUserInfo = async (accessToken: string): Promise<Record<string, unknown>> => {
  let payload: TokenPayload;
  try {
    // This provider signs from an object, so a verified token is an object payload.
    payload = verify(accessToken, getPublicKey(), {
      algorithms: ["RS256"],
      issuer: OIDC_ISSUER,
    }) as TokenPayload;
  } catch {
    throw new AppError(401, "invalid_token");
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  const scopes = ((payload["scope"] as string | undefined) || "").split(" ");
  const claims: Record<string, unknown> = { sub: payload["sub"] };
  if (scopes.includes("email")) {
    claims["email"] = payload["email"];
  }
  if (scopes.includes("profile")) {
    const user = await Users.findByPk(payload["sub"] as string);
    if (user) {
      claims["given_name"] = user.firstName;
      claims["family_name"] = user.lastName;
      claims["name"] =
        [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
    }
  }
  return claims;
};

const service = {
  discover,
  jwks,
  assertTenantExists,
  registerClient,
  getClients,
  rotateSecret,
  deleteClient,
  issueTokens,
  verifySecret,
  findClientByClientId,
  beginAuthorization,
  AUTH_REQUEST_NOT_FOUND,
  getAuthRequest,
  decideAuthorization,
  exchangeAuthorizationCode,
  refreshAccessToken,
  getUserInfo,
};

export = service;
