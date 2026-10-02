/**
 * Sign-in, sign-out, password and MFA flows, enterprise SSO and
 * impersonation: `/api/v1/auth` (index.js mounts it; authPublic.route shares
 * the path).
 *
 * P9-21 (ADR-087): converted from auth.route.js. Every route, gate, budget
 * and throttle is in the same order as before (checked against the mounted
 * route table and the module text); the inline `keyOf` calls a load-time
 * capture of `hashedKey`, as the `.js` destructured it. auth.controller,
 * firstSignIn.controller and sso.controller were required below the
 * `requestBudget(...)` calls (sso.controller mid-file); as imports they load
 * with the others, before those calls, which none of them depends on.
 * The contract is code-first: auth.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import type { Request } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ssoExchangeSchema } from "../../validators/sso.validator";
// A-67: authPreCheck refuses a locked-out caller and attaches the rate-limit
// context; the CONTROLLER records the outcome against it (auth.controller.js
// `withAuthOutcome`). There is no post-handler middleware — one mounted before
// the handler sees status 200, one mounted after it never runs.
import { authPreCheck, mfaLoginPreCheck, mfaManagePreCheck } from "../../services/rateLimiter.redis.service";
// ADR-100 (A-291, A-292): REQUEST budgets — every request counted, successes
// included, per client address (and per mailed-to address for an OTP). They
// sit in front of the failure throttles above, which are unchanged.
import { requestBudget, hashedKey as loadedHashedKey } from "../../middlewares/requestBudget.middleware";

// P10-12 (ADR-098 §8.3): self-registration exists only where it is enabled.
import { selfRegistrationGate } from "../../middlewares/selfRegistration.middleware";
import { register, login, activation, sendOTP, resetPassword, logout, logoutAll, verify, justUpdatePassword, passIsValid, refresh, socketToken, setupMfa, verifyMfaSetup, disableMfa, loginMfa, impersonateUser } from "../../controllers/auth.controller";
// P10-16 (ADR-099): the one endpoint a one-time password's first sign-in leads to.
import { changeFirstSignInPassword } from "../../controllers/firstSignIn.controller";
// ENTERPRISE SSO & SAML (required mid-file by the `.js`; see the header).
import * as ssoController from "../../controllers/sso.controller";

// A load-time capture, as the `.js` destructured it: `keyOf` below calls this
// binding, not a property read at call time (ADR-087 Amendment 13).
const hashedKey = loadedHashedKey;

// `Router` is `express.Router` (the same function).
const router = Router();

const loginBudget = requestBudget("authSignIn");
const registerBudget = requestBudget("authRegister");
const otpBudget = requestBudget("authOtp");
// The address a code is mailed to, whoever asks — counted whether or not an
// account has it, so the 429 is not an oracle.
const otpRecipientBudget = requestBudget("authOtpRecipient", {
  perAddress: false,
  keyOf: (req: Request) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" && email.trim() !== "" ? hashedKey(email) : null;
  },
});
const ssoStartBudget = requestBudget("ssoStart");
const mfaSignInBudget = requestBudget("mfaSignIn");

/* ------------------------------------------------------------------ */
/* REGISTER */
/* ------------------------------------------------------------------ */
router.post(
  "/register",
  // P10-12: off in production unless SELF_REGISTRATION_ENABLED=true — then the
  // route behaves as absent (404), before the budget or anything else runs.
  selfRegistrationGate,
  registerBudget,
  authPreCheck("register"),
  register,
);

/* ------------------------------------------------------------------ */
/* ACTIVATION */
/* ------------------------------------------------------------------ */
router.get("/activation", activation);

/* ------------------------------------------------------------------ */
/* LOGIN */
/* ------------------------------------------------------------------ */
router.post(
  "/login",
  loginBudget,
  authPreCheck("login"),
  login,
);

/* ------------------------------------------------------------------ */
/* SEND OTP (forgot password) */
/* ------------------------------------------------------------------ */
router.post(
  "/send-otp",
  otpBudget,
  otpRecipientBudget,
  authPreCheck("forgotPassword"),
  sendOTP,
);

/* ------------------------------------------------------------------ */
/* RESET PASSWORD */
/* ------------------------------------------------------------------ */
router.post(
  "/reset-password",
  otpBudget,
  authPreCheck("resetPassword"),
  resetPassword,
);

/* ------------------------------------------------------------------ */
/* LOGOUT (single session) */
/* ------------------------------------------------------------------ */
router.post("/logout", auth, logout);

/* ------------------------------------------------------------------ */
/* LOGOUT ALL (requires auth) */
/* ------------------------------------------------------------------ */
router.post("/logout-all", auth, logoutAll);

router.post("/socket-token", auth, socketToken);

/* ------------------------------------------------------------------ */
/* VERIFY SESSION (requires auth) */
/* ------------------------------------------------------------------ */
router.post("/verify", auth, verify);

/* ------------------------------------------------------------------ */
/* JUST UPDATE PASSWORD (requires auth) */
/* ------------------------------------------------------------------ */
router.post("/just-update-password", auth, justUpdatePassword);

/* ------------------------------------------------------------------ */
/* PASSWORD VALIDITY CHECK (requires auth) */
/* ------------------------------------------------------------------ */
router.post("/pass-is-valid", auth, passIsValid);

/* ------------------------------------------------------------------ */
/* REFRESH TOKEN */
/* ------------------------------------------------------------------ */
router.post(
  "/refresh",
  authPreCheck("refreshToken"),
  refresh,
);

/* ------------------------------------------------------------------ */
/* ENTERPRISE SSO & SAML INTEGRATION */
/* ------------------------------------------------------------------ */
router.post("/sso/login", ssoStartBudget, ssoController.ssoLogin);

router.post("/sso/callback", ssoController.ssoCallback);

router.post("/sso/callback/:tenantCode", ssoController.ssoCallback);

router.post("/sso/oidc/login", ssoStartBudget, ssoController.oidcLogin);

router.post("/sso/oidc/callback", ssoController.oidcCallback);

router.post("/sso/oidc/callback/:tenantCode", ssoController.oidcCallback);

// A-68/A-69: the authorize request asks for response_mode=query, so the IdP
// returns the browser here with a GET (?code&state). Only the POST routes
// existed, so an OIDC return could never reach the callback. Public, like the
// POSTs: the stored `state`, bound to the browser's cookie, is the credential.
router.get("/sso/oidc/callback", ssoController.oidcCallback);
router.get("/sso/oidc/callback/:tenantCode", ssoController.oidcCallback);

router.get("/sso/metadata", ssoController.ssoMetadata);

router.get("/sso/metadata/:tenantCode", ssoController.ssoMetadata);

router.post(
  "/sso/exchange",
  authPreCheck("ssoExchange"),
  validate(ssoExchangeSchema),
  ssoController.ssoExchange,
);

/* ------------------------------------------------------------------ */
/* MFA SETUP */
/* ------------------------------------------------------------------ */

// A-142: rate-limited per user (and per IP when AUTH_RATE_LIMIT_BY_IP).
router.post("/mfa/setup", auth, mfaManagePreCheck(), setupMfa);

router.post("/mfa/verify", auth, mfaManagePreCheck(), verifyMfaSetup);

router.post("/mfa/disable", auth, mfaManagePreCheck(), disableMfa);

/* ------------------------------------------------------------------ */
/* IMPERSONATION */
/* ------------------------------------------------------------------ */

router.post("/impersonate", auth, impersonateUser);

router.post("/impersonate/exit", auth, logout);

// /mfa/setup and /mfa/verify are registered earlier in this file; the
// duplicate registrations that used to sit here were dead (express matches the
// first). Only /mfa/login is unique to this block.

// A-81: rate-limited. mfaLoginPreCheck refuses a locked user, token or address
// and the handler records the outcome (withAuthOutcome).
router.post("/mfa/login", mfaSignInBudget, mfaLoginPreCheck(), loginMfa);

// No lockout pre-check: nothing here is guessable — the token is signed, lives
// ten minutes and dies with the change it allows. The global API limiter applies.
router.post("/first-sign-in/password", changeFirstSignInPassword);

export = router;
