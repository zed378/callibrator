// P9-20 (ADR-087): converted from webauthn.controller.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order). The service and signInPolicy are the module
// objects; `asyncHandler` and `success` are captured at load. The `.js` also
// destructured `auth` from auth.middleware and never used it: the module is
// still loaded here, at the same point (a side-effect import).
//
// The attestation and assertion are the authenticator's responses as the
// browser sent them. They are typed as such (a view of the body, not a
// guarantee): @simplewebauthn's verifiers inside the service check them.
import type { Request, Response } from "express";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import webauthnService from "../services/webauthn.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import "../middlewares/auth.middleware";
// A-288 (ADR-100): the tenant's IP allowlist and geofence at a passkey sign-in.
import * as signInPolicy from "../services/signInPolicy.service";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;

/** The principal `auth` put on the request. */
interface Caller {
  id: string;
  tenantId: TenantId | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

/** The request, with the caller `auth` set (read with `?.`, as the `.js` did). */
type WebauthnRequest = Request & { user?: Caller };

/** The registration body: the attestation, plus the owner's label for the passkey. */
type RegistrationBody = RegistrationResponseJSON & { name?: unknown };

/** The sign-in body: the assertion, plus the device-reported position. */
type LoginBody = AuthenticationResponseJSON & { location?: unknown };

/** The disable body: the re-authentication proof (A-213). */
interface DisableBody {
  currentPassword?: string;
  code?: string;
  recoveryCode?: string;
}

const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const r = req as WebauthnRequest;
  const result = await webauthnService.getStatus(r.user?.tenantId as TenantId | null, r.user?.id as string);
  success(res, result, null, "WebAuthn status");
});

const getRegistrationOptions = asyncHandler(async (req: Request, res: Response) => {
  const r = req as WebauthnRequest;
  const options = await webauthnService.getRegistrationOptions(r.user as Caller);
  success(res, options, null, "WebAuthn registration options");
});

const verifyRegistration = asyncHandler(async (req: Request, res: Response) => {
  const r = req as WebauthnRequest;
  // ADR-108 Amendment 1: `name` is the owner's label for this passkey; it is
  // not part of the attestation. Audited with the registration.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { name, ...attestation } = (r.body as RegistrationBody | undefined) || {};
  const result = await webauthnService.verifyRegistration(
    r.user?.tenantId as TenantId | null,
    r.user?.id as string,
    attestation as RegistrationResponseJSON,
    {
      name: typeof name === "string" ? name : null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
      ipAddress: r.ip || null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…] || null`
      userAgent: r.headers?.["user-agent"] || null,
    },
  );
  success(res, result, null, "WebAuthn registration verified");
});

const getLoginOptions = asyncHandler(async (req: Request, res: Response) => {
  const r = req as WebauthnRequest;
  const options = await webauthnService.getLoginOptions(r.user?.id as string);
  success(res, options, null, "WebAuthn login options");
});

const verifyLogin = asyncHandler(async (req: Request, res: Response) => {
  const r = req as WebauthnRequest;
  // `location` is the device-reported position for a tenant geofence; it is
  // not part of the WebAuthn assertion.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { location, ...assertion } = (r.body as LoginBody | undefined) || {};
  const result = await webauthnService.verifyLogin(
    r.user?.tenantId as TenantId | null,
    r.user?.id as string,
    assertion as AuthenticationResponseJSON,
  );
  // A-288: after the assertion is proven — a refusal says nothing to a caller
  // without the credential — and before the success is reported.
  await signInPolicy.assertSignInPermitted(
    { id: r.user?.id as string, tenantId: r.user?.tenantId },
    {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
      ip: r.ip || null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…] || null`
      userAgent: r.headers?.["user-agent"] || null,
      location,
      method: "passkey",
    },
  );
  success(res, result, null, "WebAuthn login verified");
});

// A-213: removing the passkey needs the current password (and, with MFA, a
// current code or recovery code) from the body; it is audited.
const disable = asyncHandler(async (req: Request, res: Response) => {
  const r = req as WebauthnRequest;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { currentPassword, code, recoveryCode } = (r.body as DisableBody | undefined) || {};
  const result = await webauthnService.disable(
    r.user?.tenantId as TenantId | null,
    r.user?.id as string,
    { currentPassword, code, recoveryCode },
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: empty values read as null
    { ipAddress: r.ip || null, userAgent: r.headers?.["user-agent"] || null },
  );
  success(res, result, null, "WebAuthn disabled");
});

const controller = {
  getStatus,
  getRegistrationOptions,
  verifyRegistration,
  getLoginOptions,
  verifyLogin,
  disable,
};

export = controller;
