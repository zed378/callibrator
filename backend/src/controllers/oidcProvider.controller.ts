// P9-20 (ADR-087): converted from oidcProvider.controller.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order; `token` and `userinfo`, formerly anonymous
// `exports.x = async (req, res) => …` functions, are now named after their key,
// the one accepted surface change). The service is the module object; every
// other load-time destructure is kept as a capture at load. Request data is
// read through typed views of the request; the emitted expressions are the
// `.js` ones.
import type { Request, Response } from "express";

import oidcProviderService from "../services/oidcProvider.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { error as loadedError, success as loadedSuccess } from "../utils/response.util";
import { oidcClientSchema as loadedOidcClientSchema } from "../validators/oidc.validator";
import { validateInput as loadedValidate } from "../validators/input";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const sendError = loadedError;
const oidcClientSchema = loadedOidcClientSchema;
const validate = loadedValidate;
const auditActor = loadedAuditActor;

/** The principal `auth` put on the request. */
interface Caller {
  id?: string;
  tenantId: TenantId;
}

/** The path parameters these routes name. */
interface OidcParams extends Record<string, string> {
  requestId: string;
  clientId: string;
  tenantId: TenantId;
}

/** A thrown value, read the way the `.js` read it. */
interface Thrown {
  status?: number;
  message?: unknown;
}

/** The token-endpoint body (RFC 6749 names). */
interface TokenBody {
  grant_type?: string;
  code?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
}

// --------------------------------------------------------------------------
// Public OIDC metadata — returned as RAW JSON (the OIDC spec shape), NOT the
// app's {success,data} envelope, so conformant relying-party libraries can
// parse them.
// --------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/require-await -- as built: an async handler, so its result is a promise the wrapper chains
const discover = asyncHandler(async (_req: Request, res: Response) => {
  res.json(oidcProviderService.discover());
});

// eslint-disable-next-line @typescript-eslint/require-await -- as built: an async handler, so its result is a promise the wrapper chains
const jwks = asyncHandler(async (_req: Request, res: Response) => {
  res.json(oidcProviderService.jwks());
});

// --------------------------------------------------------------------------
// Authorization endpoint (browser) — validate + redirect to the consent screen.
// --------------------------------------------------------------------------

const authorize = asyncHandler(async (req: Request, res: Response) => {
  const { consentUrl } = await oidcProviderService.beginAuthorization(req.query);
  res.redirect(consentUrl);
});

// The consent screen (authenticated) reads the staged request to render it.
const getAuthRequest = asyncHandler(async (req: Request, res: Response) => {
  // A-275: only a user of the client's tenant sees the request; another
  // tenant's is the same 404 as one that does not exist.
  const data = await oidcProviderService.getAuthRequest((req.params as OidcParams).requestId, req.user as Caller | undefined);
  if (!data) {
    // 2026-10-11 (ADR-137): a 404 is `success: false` (it went through success() and said true).
    return sendError(res, "Authorization request not found", 404);
  }
  success(res, data, null, "Authorization request");
  return undefined;
});

// The authenticated user's Approve/Deny decision → returns the redirect target.
const decision = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { request, approve } = (req.body as { request?: unknown; approve?: unknown } | undefined) || {};
  const result = await oidcProviderService.decideAuthorization(
    request as string,
    req.user as Caller,
    approve === true || approve === "true",
    auditActor(req),
  );
  success(res, result, null, "Authorization decision");
});

// --------------------------------------------------------------------------
// Token + userinfo — RAW JSON, with OAuth 2.0-style error bodies.
// --------------------------------------------------------------------------

const oauthError = (res: Response, err: Thrown): void => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status reads as 400
  const status = err.status || 400;
  // Service errors are formatted "error_code: description".
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: an empty message reads as "invalid_request"; the message is coerced as thrown
  const [code, ...rest] = String(err.message || "invalid_request").split(":");
  res.status(status).json({
    error: rest.length ? (code as string).trim() : "invalid_request",
    // As built: an empty description falls back to the message (`||`).
    error_description: rest.join(":").trim() || err.message,
  });
};

const token = async (req: Request, res: Response): Promise<Response | undefined> => {
  try {
    const {
      grant_type,
      code,
      client_id,
      client_secret,
      redirect_uri,
      code_verifier,
      refresh_token,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    } = (req.body as TokenBody | undefined) || {};

    let tokens;
    if (grant_type === "authorization_code") {
      tokens = await oidcProviderService.exchangeAuthorizationCode({
        code,
        clientId: client_id,
        clientSecret: client_secret,
        redirectUri: redirect_uri,
        codeVerifier: code_verifier,
      });
    } else if (grant_type === "refresh_token") {
      tokens = await oidcProviderService.refreshAccessToken({
        refreshToken: refresh_token,
        clientId: client_id,
        clientSecret: client_secret,
      });
    } else {
      return res
        .status(400)
        .json({ error: "unsupported_grant_type" });
    }
    res.json(tokens);
  } catch (err) {
    oauthError(res, err as Thrown);
  }
  return undefined;
};

const userinfo = async (req: Request, res: Response): Promise<Response | undefined> => {
  try {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a missing header reads as ""
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!bearer) {
      return res.status(401).json({ error: "invalid_token" });
    }
    const claims = await oidcProviderService.getUserInfo(bearer);
    res.json(claims);
  } catch (err) {
    oauthError(res, err as Thrown);
  }
  return undefined;
};

// --------------------------------------------------------------------------
// Client management (app-internal API) — keeps the {success,data} envelope.
// --------------------------------------------------------------------------

const registerClient = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.body, oidcClientSchema);
  const result = await oidcProviderService.registerClient((req.user as Caller | undefined)?.tenantId as TenantId, validated, auditActor(req));
  success(res, result, null, "OIDC client registered");
});

const getClients = asyncHandler(async (req: Request, res: Response) => {
  const result = await oidcProviderService.getClients((req.user as Caller | undefined)?.tenantId as TenantId);
  success(res, result, null, "Fetch OIDC clients");
});

const rotateSecret = asyncHandler(async (req: Request, res: Response) => {
  const { clientId } = req.params as OidcParams;
  const result = await oidcProviderService.rotateSecret((req.user as Caller | undefined)?.tenantId as TenantId, clientId, auditActor(req));
  success(res, result, null, "Client secret rotated");
});

const deleteClient = asyncHandler(async (req: Request, res: Response) => {
  const { clientId } = req.params as OidcParams;
  const result = await oidcProviderService.deleteClient((req.user as Caller | undefined)?.tenantId as TenantId, clientId, auditActor(req));
  success(res, result, null, "OIDC client deleted");
});

// --------------------------------------------------------------------------
// A-280 (ADR-094) — the same four operations on a tenant the operator NAMES.
// The routes above act on the operator's home tenant: they register PLATFORM
// clients, which only that tenant's users may approve (A-275). A client a
// hospital's users sign in to must live in the hospital's tenant, and the
// operator says which tenant in the path — never in a body, never through
// the x-tenant-id override.
// --------------------------------------------------------------------------

const getTenantClients = asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as OidcParams;
  await oidcProviderService.assertTenantExists(params.tenantId);
  const result = await oidcProviderService.getClients(params.tenantId);
  success(res, result, null, "Fetch OIDC clients");
});

const registerTenantClient = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.body, oidcClientSchema);
  const params = req.params as OidcParams;
  await oidcProviderService.assertTenantExists(params.tenantId);
  const result = await oidcProviderService.registerClient(params.tenantId, validated, auditActor(req));
  success(res, result, null, "OIDC client registered");
});

const rotateTenantClientSecret = asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as OidcParams;
  await oidcProviderService.assertTenantExists(params.tenantId);
  const result = await oidcProviderService.rotateSecret(params.tenantId, params.clientId, auditActor(req));
  success(res, result, null, "Client secret rotated");
});

const deleteTenantClient = asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as OidcParams;
  await oidcProviderService.assertTenantExists(params.tenantId);
  const result = await oidcProviderService.deleteClient(params.tenantId, params.clientId, auditActor(req));
  success(res, result, null, "OIDC client deleted");
});

const controller = {
  discover,
  jwks,
  authorize,
  getAuthRequest,
  decision,
  token,
  userinfo,
  registerClient,
  getClients,
  rotateSecret,
  deleteClient,
  getTenantClients,
  registerTenantClient,
  rotateTenantClientSecret,
  deleteTenantClient,
};

export = controller;
