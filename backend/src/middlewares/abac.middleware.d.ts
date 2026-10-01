/**
 * Types for `src/middlewares/abac.middleware.js`, which is still JavaScript.
 * Written for P9-20/P9-21 (ADR-087, the route conversions): the release build compiles with `allowJs: false`, so a `.ts` module (a converted route) cannot import a `.js` one without declared types. TypeScript resolves the import to this file; Node resolves it to the `.js`. This file emits nothing and is never copied into `dist/`. It declares exactly the keys the module exports (held by tests/guards/declarationDrift.p912), members as PROPERTIES so a load-time destructure is sound. A member no converted module uses is `(...args: never[]) => unknown` (its first TypeScript caller types it). It is deleted when the module converts (P9-19 round 2).
 */
import type { RequestHandler } from "express";

declare const abacMiddleware: {
  /** The attribute gate: the principal needs every listed permission. */
  abac: (
    permissions: readonly string[],
    options?: { checkTenant?: boolean; checkSelf?: boolean },
  ) => RequestHandler;
};

export = abacMiddleware;
