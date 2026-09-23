// src/controllers/search.controller.js
const searchService = require("../services/search.service");
const { dynamicAccess } = require("../middlewares/dynamicAccess.middleware");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

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
const canRead = (req, menuSlug) =>
  new Promise((resolve) => {
    // A probe response: dynamicAccess answers either by calling next()
    // (allowed) or by writing a 401/403/500 (denied).
    const probe = { status: () => ({ json: () => resolve(false) }) };
    dynamicAccess(menuSlug, "read")(req, probe, () => resolve(true));
  });

const permittedTypes = async (req, requested) => {
  const candidates = requested || Object.keys(searchService.TYPE_MENUS);
  const allowed = [];
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
exports.search = asyncHandler(async (req, res) => {
  const types = req.query.types
    ? String(req.query.types)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    : undefined;

  const data = await searchService.search(req.user.tenantId, {
    q: req.query.q,
    // A requested type is searched only if the caller may read it. The
    // service treats this explicit list as exhaustive, so an empty one
    // searches nothing.
    types: await permittedTypes(req, types),
    limit: req.query.limit,
  });

  success(res, data, null, "Search results", 200);
});
