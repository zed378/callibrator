/**
 * Types for `src/middlewares/auth.middleware.js`, which is still JavaScript.
 * Written for P9-20/P9-21 (ADR-087, the route conversions): the release build compiles with `allowJs: false`, so a `.ts` module (a converted route) cannot import a `.js` one without declared types. TypeScript resolves the import to this file; Node resolves it to the `.js`. This file emits nothing and is never copied into `dist/`. It declares exactly the keys the module exports (held by tests/guards/declarationDrift.p912), members as PROPERTIES so a load-time destructure is sound. A member no converted module uses is `(...args: never[]) => unknown` (its first TypeScript caller types it). It is deleted when the module converts (P9-19 round 2).
 */
import type { RequestHandler } from "express";

declare const authMiddleware: {
  /** Whether an access token without a `sid` is accepted (false since ADR-085). */
  SIDLESS_ACCESS_TOKENS_ACCEPTED: boolean;
  /** The routes a must-change-password principal may still reach (A-123). */
  PASSWORD_CHANGE_ALLOWED: ReadonlySet<string>;
  /** The error code of the must-change-password refusal. */
  PASSWORD_CHANGE_REQUIRED_CODE: string;
  /** The routes a principal who must enrol MFA may still reach (A-160). */
  MFA_ENROLMENT_ALLOWED: ReadonlySet<string>;
  /** The error code of the MFA-enrolment refusal. */
  MFA_ENROLMENT_REQUIRED_CODE: string;
  /** Verifies the bearer token (or API key) and sets `req.user`; 401 otherwise. */
  auth: RequestHandler;
  /** As `auth`, but an anonymous request passes through without `req.user`. */
  optionalAuth: RequestHandler;
  /** 403 for an API-key principal. */
  denyApiKey: RequestHandler;
  /** 403 unless the principal is the platform super admin (role.util#isSuperAdmin). */
  superAdminOnly: RequestHandler;
};

export = authMiddleware;
