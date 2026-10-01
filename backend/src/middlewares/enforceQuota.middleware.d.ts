/**
 * Types for `src/middlewares/enforceQuota.middleware.js`, which is still
 * JavaScript. Written for P9-20/P9-21 (ADR-087, the route conversions): the release build compiles with `allowJs: false`, so a `.ts` module (a converted route) cannot import a `.js` one without declared types. TypeScript resolves the import to this file; Node resolves it to the `.js`. This file emits nothing and is never copied into `dist/`. It declares exactly the keys the module exports (held by tests/guards/declarationDrift.p912), members as PROPERTIES so a load-time destructure is sound. A member no converted module uses is `(...args: never[]) => unknown` (its first TypeScript caller types it). It is deleted when the module converts (P9-19 round 2).
 */
import type { RequestHandler } from "express";

declare const enforceQuotaMiddleware: {
  /** 403 when the tenant has no seat left (tenant.limitSeats). */
  enforceSeatQuota: () => RequestHandler;
  /** 403 when the upload would exceed the tenant's storage quota. */
  enforceStorageQuota: () => RequestHandler;
  /** 403 unless the tenant's plan includes `feature`. */
  requireFeature: (feature: string) => RequestHandler;
};

export = enforceQuotaMiddleware;
