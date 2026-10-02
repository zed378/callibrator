/**
 * Unified search, `/api/v1/search`.
 *
 * P9-18 (ADR-087): converted from search.controller.js, behaviour unchanged.
 * `dynamicAccess`, `asyncHandler` and `success` are captured at load, as the
 * `.js` destructured them; the service is read through its module object at
 * call time. `req.user` is read without a guard (`auth` and the route gate run
 * first), and the query values are passed on raw, as before (the service
 * coerces them). `export =` keeps the exact object `require()` returned.
 */
import type { NextFunction, Request, Response } from "express";
import searchService from "../services/search.service";
import { dynamicAccess as loadedDynamicAccess } from "../middlewares/dynamicAccess.middleware";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import type { SeededMenuSlug } from "../constants/seededMenuSlugs";
import type { TenantId } from "../types/ids";

const dynamicAccess = loadedDynamicAccess;
const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;

/** The principal `auth` set (read without a guard, as before). */
interface SearchPrincipal {
  tenantId: TenantId;
}

// A-04. Search read devices, stock and certificates for the whole tenant with
// no authorization check, so a principal that cannot list a type still saw its
// rows here. Each type is now resolved through the SAME gate its own list
// route runs -- dynamicAccess(<menu>, "read") -- rather than a second copy of
// the permission rules, which would be free to drift from the first. Role
// matrix, per-user overrides, super-admin bypass and API-key scopes therefore
// all behave here exactly as they do on /stock, /calibration-devices and
// /certificates.
//
// A denied type is dropped from the search, never turned into a 403: a caller
// entitled to one type still gets that type's rows. A caller entitled to none
// does not reach this controller -- the route gate refuses the request.
const canRead = (req: Request, menuSlug: string): Promise<boolean> =>
  new Promise((resolve) => {
    // A probe response: dynamicAccess answers by calling a bare next()
    // (allowed), by writing a 401/403/404 (denied), or -- when the check
    // itself fails -- by calling next(err) (A-13). ONLY a bare next() means
    // allowed: next(err) must deny, or a failure of the permission store
    // would read as "allowed for every type" and search would fail open.
    const probe = { status: () => ({ json: () => { resolve(false); } }) };
    // The gate's own result is not awaited, as before: the probe and `next` settle the promise.
    void dynamicAccess(menuSlug as SeededMenuSlug, "read")(req, probe as unknown as Response, ((err?: unknown) => { resolve(!err); }) as NextFunction);
  });

const permittedTypes = async (req: Request, requested: string[] | undefined): Promise<string[]> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `requested` is a list or undefined
  const candidates = requested || Object.keys(searchService.TYPE_MENUS);
  const allowed: string[] = [];
  for (const type of candidates) {
    const menu = searchService.TYPE_MENUS[type];
    // An unknown type name has no menu to check; the service drops it too.
    if (menu && (await canRead(req, menu))) {
      allowed.push(type);
    }
  }
  return allowed;
};

// GET /api/v1/search?q=&types=device,stock&limit=
const search = asyncHandler(async (req: Request, res: Response) => {
  const types = req.query["types"]
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: a repeated or nested parameter is stringified as the JavaScript did
    ? String(req.query["types"])
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    : undefined;

  const data = await searchService.search((req.user as SearchPrincipal).tenantId, {
    q: req.query["q"] as string | undefined,
    // A requested type is searched only if the caller may read it. The
    // service treats this explicit list as exhaustive, so an empty one
    // searches nothing.
    types: await permittedTypes(req, types),
    limit: req.query["limit"],
  });

  success(res, data, null, "Search results", 200);
});

const controller = { search };

export = controller;
