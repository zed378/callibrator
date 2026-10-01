/**
 * Types for `src/middlewares/dynamicAccess.middleware.js`, which is still
 * JavaScript. Written for P9-20/P9-21 (ADR-087, the route conversions): the release build compiles with `allowJs: false`, so a `.ts` module (a converted route) cannot import a `.js` one without declared types. TypeScript resolves the import to this file; Node resolves it to the `.js`. This file emits nothing and is never copied into `dist/`. It declares exactly the keys the module exports (held by tests/guards/declarationDrift.p912), members as PROPERTIES so a load-time destructure is sound. A member no converted module uses is `(...args: never[]) => unknown` (its first TypeScript caller types it). It is deleted when the module converts (P9-19 round 2).
 */
import type { RequestHandler } from "express";

/** The options a gate takes. */
interface DynamicAccessOptions {
  /** Require every listed action (AND) instead of any (OR, the default). */
  requireAll?: boolean;
  /** Allow the caller on a route whose path names them. */
  checkSelf?: boolean;
  /** Every `tenantId` the request names must be the caller's. */
  checkTenant?: boolean;
}

declare const dynamicAccessMiddleware: {
  selfOwnerIdFromPath: (...args: never[]) => unknown;
  tenantIdsNamedBy: (...args: never[]) => unknown;
  ownerIdsNamedBy: (...args: never[]) => unknown;
  /** The permission gate: the principal needs `permissionType` on `menuGroup` (a menu slug). */
  dynamicAccess: (
    menuGroup: string | readonly string[],
    permissionType: string | readonly string[],
    options?: DynamicAccessOptions,
  ) => RequestHandler;
  /** Whether a principal (a user with its role, or an API key) holds `permissionType` on a menu slug. Typed for eSignature.service. */
  principalHasMenuPermission: (
    principal: { id?: string; role?: { id?: string; name?: string } | null; isApiKey?: boolean; [field: string]: unknown },
    menuName: string,
    permissionType: string,
  ) => Promise<boolean>;
  hasDynamicPermission: (...args: never[]) => unknown;
};

export = dynamicAccessMiddleware;
