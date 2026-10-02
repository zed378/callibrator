/**
 * Menu groups and role menu assignments: `/api/v1/menu-groups` and
 * `/api/v1/menu-group-roles` (index.js mounts it twice).
 *
 * P9-18 (ADR-087): converted from menuGroups.route.js. Every route and
 * middleware is in the same order as before (checked against the mounted route table). The
 * contract is code-first: menuGroups.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import menuGroupController from "../../controllers/menuGroup.controller";
import { auth } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { forbidden as loadedForbidden } from "../../utils/response.util";
import { isSuperAdmin as loadedIsSuperAdmin } from "../../utils/role.util";

// `Router` is `express.Router` (the same function).
const router = Router();
const forbidden = loadedForbidden;
const isSuperAdmin = loadedIsSuperAdmin;

// N-01: the one super-admin predicate (both spellings).

/**
 * AZ-01 (G-06) / P6-04 — the three user-facing menu reads take a `roleId`
 * (query or body) and answered for ANY role, so every user could read the
 * permission matrix of every role. The sidebar only ever asks for the caller's
 * own role (DashboardLayout: `user.roleId`), so that is what a non-SUPERADMIN
 * may ask for. Roles are global, not tenant-owned, so a refusal here is an
 * in-tenant permission failure (403), not a tenant-membership oracle.
 *
 * @param {object} req - request
 * @param {object} res - response
 * @param {Function} next - next
 * @returns {void}
 */
function ownRoleOnly(req: Request, res: Response, next: NextFunction): unknown {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: no principal reads as {}
  const user = (req.user || {}) as { roleId?: unknown; role?: { id?: unknown; name?: string } };
  if (isSuperAdmin(user)) {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the gate answers what `next` answers
    return next();
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: an empty query value falls back to the body's; the query is optional-chained as the JavaScript did
  const asked: unknown = (req.query as { roleId?: unknown })?.roleId || (req.body as { roleId?: unknown } | undefined)?.roleId;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  const own = user.roleId || user.role?.id;
  if (asked === undefined || (own && asked === own)) {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the gate answers what `next` answers
    return next();
  }
  return forbidden(res, "You may only read the menu of your own role");
}

/* ------------------------------------------------------------------ */
/* FILTER MENU GROUPS (user-facing) */
/* ------------------------------------------------------------------ */
router.post("/filter", auth, ownRoleOnly, menuGroupController.filterMenuGroups);

router.post(
  "/get-assignments",
  auth,
  ownRoleOnly,
  menuGroupController.getRoleMenuAssignments,
);

router.get("/my-permissions", auth, menuGroupController.getMyPermissions);

router.get("/menu-groups", auth, ownRoleOnly, menuGroupController.filterMenuGroups);

/* ------------------------------------------------------------------ */
/* ADMIN-ENDPOINTS (SUPERADMIN required) */
/* ------------------------------------------------------------------ */
router.get(
  "/menu-groups/admin",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.filterMenuGroups,
);

router.get(
  "/roles",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.getAvailableRoles,
);

router.post(
  "/create",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.createMenuGroup,
);

router.post(
  "/update",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.updateMenuGroup,
);

router.post(
  "/delete",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.deleteMenuGroup,
);

router.post(
  "/assign",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.assignMenuGroupToRole,
);

router.post(
  "/revoke",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.revokeMenuGroupFromRole,
);

router.post(
  "/assign-item",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.assignMenuGroupToRole,
);

router.post(
  "/revoke-item",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.revokeMenuGroupFromRole,
);

router.post(
  "/bulk-assign",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.bulkAssignMenuGroups,
);

router.post(
  "/bulk-revoke",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.bulkRevokeMenuGroups,
);

export = router;
