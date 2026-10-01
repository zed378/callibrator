/**
 * Phase 10 (ADR-098) — public sign-in routes, mounted beside auth.route.js at
 * /api/v1/auth (a new route module, so TypeScript: ADR-087).
 *
 * All PUBLIC (route-gate exemption kind `public`, each with its defence):
 *   POST /login/discover    P10-04  by email DOMAIN only — no account looked up
 *   POST /sso/start         P10-04  one A-292 refusal for every reason
 *   POST /passkey/options   P10-10  no identifier in, no allowCredentials out
 *   POST /passkey/verify    P10-10  the assertion is the credential; UV required
 *   POST /invitation/accept P10-15  the single-use invitation token is the capability
 *
 * Each sits behind an ADR-100 request budget per client address (the SSO start
 * shares `ssoStart` with /sso/login and /sso/oidc/login, so spreading probes
 * across the three buys nothing). The passkey verify also counts a failure for
 * a known credential against that account's sign-in throttle (A-185).
 *
 * The contract is code-first: authPublic.openapi.ts (P9-25).
 */
import { Router } from "express";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  invitationAcceptSchema,
  loginDiscoverSchema,
  passkeyVerifySchema,
  ssoStartSchema,
} from "../../validators/publicAuth.validator";
import {
  discover,
  invitationAccept,
  passkeyOptions,
  passkeyVerify,
  ssoStart,
} from "../../controllers/publicAuth.controller";

const router = Router();

const passkeyBudget = requestBudget("passkeyLogin");

router.post("/login/discover", requestBudget("loginDiscover"), validate(loginDiscoverSchema), discover);
router.post("/sso/start", requestBudget("ssoStart"), validate(ssoStartSchema), ssoStart);
router.post("/passkey/options", passkeyBudget, passkeyOptions);
router.post("/passkey/verify", passkeyBudget, validate(passkeyVerifySchema), passkeyVerify);
router.post("/invitation/accept", requestBudget("invitationAccept"), validate(invitationAcceptSchema), invitationAccept);

export = router;
