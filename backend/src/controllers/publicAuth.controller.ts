/**
 * Phase 10 (ADR-098) — the public sign-in additions: identifier-first
 * discovery and the organisation-code SSO start (P10-04), the passwordless
 * passkey ceremony (P10-10) and accepting an invitation (P10-15). The address
 * and user agent come from the request itself, never the body.
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { login, success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import {
  invitationAcceptSchema,
  loginDiscoverSchema,
  passkeyVerifySchema,
  ssoStartSchema,
} from "../validators/publicAuth.validator";
import { discoverSignIn } from "../services/loginDiscovery.service";
import { getPasskeyLoginOptions, verifyPasskeyLogin } from "../services/passkeyLogin.service";
import { acceptInvitation } from "../services/invitation.service";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requestOriginOf } from "../utils/requestOrigin.util";

/** sso.controller.js#startSsoFor, as called here (JavaScript). */
interface SsoStarter {
  startSsoFor: (tenantCode: string, res: Response) => Promise<{ redirectUrl: string }>;
}

/** POST /auth/login/discover — always 200: `{ next: "password" }` or `{ next: "sso", redirectUrl }`. */
export const discover = asyncHandler(async (req: Request, res: Response) => {
  const { identifier } = validated(req, loginDiscoverSchema);
  success(res, await discoverSignIn(identifier, res), "Next sign-in step", 200);
});

/** POST /auth/sso/start — 200 `{ redirectUrl }`, or the ONE A-292 refusal (404) for every reason. */
export const ssoStart = asyncHandler(async (req: Request, res: Response) => {
  const { orgCode } = validated(req, ssoStartSchema);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a JavaScript controller, typed by the one function used
  const { startSsoFor } = require("./sso.controller") as SsoStarter;
  const { redirectUrl } = await startSsoFor(orgCode, res);
  success(res, { redirectUrl }, "SSO redirect URL generated", 200);
});

/** POST /auth/passkey/options — the same shape for every caller; nothing about any account. */
export const passkeyOptions = asyncHandler(async (_req: Request, res: Response) => {
  success(res, await getPasskeyLoginOptions(), "Passkey sign-in started", 200);
});

/** POST /auth/passkey/verify — answers exactly as a completed POST /auth/login does. */
export const passkeyVerify = asyncHandler(async (req: Request, res: Response) => {
  const { ceremonyId, credential } = validated(req, passkeyVerifySchema);
  const result = (await verifyPasskeyLogin(
    // The validator checked the shape the library reads; the library verifies the rest.
    { ceremonyId, credential: credential as AuthenticationResponseJSON },
    requestOriginOf(req),
  )) as { data: unknown; token: unknown; session: { id: string; expiredAt?: unknown } | null; refreshToken: unknown };
  login(res, result.data, result.token, result.session, { refreshToken: result.refreshToken });
});

/** POST /auth/invitation/accept — sets the invited administrator's password; one 400 for any bad link. */
export const invitationAccept = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = validated(req, invitationAcceptSchema);
  const { ip, userAgent } = requestOriginOf(req);
  await acceptInvitation(token, password, { ipAddress: ip, userAgent });
  success(res, null, "Invitation accepted", 200);
});
