/**
 * P10-16 (ADR-099) — POST /api/v1/auth/first-sign-in/password.
 *
 * Public: the caller has no session, only the `password-change` purpose token
 * a one-time password's first sign-in returned. The token travels in the body
 * (as the MFA token does to /auth/mfa/login); `auth` refuses it on every route.
 */
import type { Request, Response } from "express";

import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { completeFirstSignInPasswordChange } from "../services/bootstrapCredential.service";

const changeFirstSignInPassword = asyncHandler(async (req: Request, res: Response) => {
  const userAgent = req.headers["user-agent"];
  const result = await completeFirstSignInPasswordChange(req.body, {
    ipAddress: req.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  });
  success(res, result.data, null, result.message, 200);
});

export { changeFirstSignInPassword };
