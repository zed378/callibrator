/**
 * The facility route gate (P21-09; ADR-124 § 7, Am. 1 § 3, Am. 2 § 8; spec
 * MEMORY/specs/P19-04-client-facilities.md § 7.7; AM-12).
 *
 * A facility-BOUND principal may call only the routes on FACILITY_ACCESSIBLE_ROUTES; every other
 * mounted route answers 403 `FACILITY_ROUTE_REFUSED` — deny by default. It is called FROM
 * `tenantContextMiddleware` (inside the context it has just built), so it covers routers that
 * mount `auth` with `router.use(auth)` as well as route-level `auth`, and it runs before any
 * `validate` reads a parameter: the answer is identical for a valid and an invalid id (AM-12).
 *
 * The route is resolved the way Express will dispatch it (utils/routeTable#resolveRoute over the
 * index registered at boot), so a shadowing route resolves to the route Express runs. No index
 * registered refuses every bound request; no route matched passes (Express answers 404).
 * A `selfParam` entry (S-7) also refuses a path parameter that is not the caller.
 *
 * Unbound principals, the super admin and system work pass untouched (one store read).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { NextFunction, Request, Response } from "express";
import { FACILITY_ACCESSIBLE_ROUTES, type FacilityAccessibleRoute } from "../constants/facilityAccess";
import { resolveRoute, routeIndex } from "../utils/routeTable";
import type { TenantContextStore } from "./tenantContext.middleware";

/** The refusal's code and message (spec § 7.7; `FACILITY_REFUSAL_CODES`). */
export const FACILITY_ROUTE_REFUSED = "FACILITY_ROUTE_REFUSED";
export const FACILITY_ROUTE_REFUSED_MESSAGE = "This action is not available to facility accounts.";

/** The request's pathname, as router reads it (no query, no fragment). */
const pathnameOf = (req: Request): string => {
  const raw = req.originalUrl || req.url || "/";
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
};

/** The marker of a resolved route, if it has one. */
const markerOf = (file: string | null, key: string): FacilityAccessibleRoute | null =>
  (file ? FACILITY_ACCESSIBLE_ROUTES[file]?.[key] : undefined) ?? null;

/**
 * Whether `context` is a bound principal's — the only one this gate applies to.
 *
 * @param context - the context tenantContextMiddleware built
 * @returns whether to gate
 */
export const gatesContext = (context: TenantContextStore): boolean =>
  context.facilityBound === true && !context.isSuperAdmin && !context.isSystemTask;

/**
 * Pass, or refuse with 403 `FACILITY_ROUTE_REFUSED`, a bound principal's request.
 *
 * @param context - the request's context (tenantContextMiddleware's)
 * @param req - the request
 * @param res - the response
 * @param next - the next middleware
 */
export const facilityRouteGate = (context: TenantContextStore, req: Request, res: Response, next: NextFunction): void => {
  if (!gatesContext(context)) {
    next();
    return;
  }
  const refuse = (): void => {
    res.status(403).json({ success: false, status: 403, message: FACILITY_ROUTE_REFUSED_MESSAGE, data: null, code: FACILITY_ROUTE_REFUSED });
  };
  const index = routeIndex();
  if (!index) {
    refuse();
    return;
  }
  const route = resolveRoute(index.root, req.method, pathnameOf(req), index.fileOf);
  if (!route) {
    next();
    return;
  }
  const marker = markerOf(route.file, route.key);
  if (!marker) {
    refuse();
    return;
  }
  if (marker.selfParam && route.params[marker.selfParam] !== context.userId) {
    refuse();
    return;
  }
  next();
};
