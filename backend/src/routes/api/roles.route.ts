/**
 * Roles, menu groups, role assignment and role-menu permissions:
 * `/api/v1/roles` (index.js mounts it). Super admin only.
 *
 * P9-21 (ADR-087): converted from roles.route.js. Every route, gate and
 * middleware is in the same order as before, `validateUuid` still FIRST on the
 * `:id` routes (checked against the mounted route table).
 *
 * The contract is code-first: roles.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import {
  getAllRoles,
  getAllMenus,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getMenuById,
  createMenu,
  updateMenu,
  deleteMenu,
  assignPermissionToRole,
  removePermissionFromRole,
  assignRoleToUser,
  removeRoleFromUser,
} from "../../controllers/roles.controller";
import { auth } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { createRoleSchema, updateRoleSchema, createMenuSchema } from "../../validators/roles.validator";
import { validateUuid } from "../../middlewares/validateUuid.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

/* ------------------------------------------------------------------ */
/*                     ROLES ENDPOINTS                                 */
/* ------------------------------------------------------------------ */

router.get("/", auth, rbac(["SUPERADMIN"]), getAllRoles);

// NOTE: "/menus" must be registered BEFORE "/:id", otherwise GET /roles/menus
// is captured by the ":id" param and rejected by validateUuid with a 400.
router.get("/menus", auth, rbac(["SUPERADMIN"]), getAllMenus);

router.get("/:id", validateUuid("id"), auth, rbac(["SUPERADMIN"]), getRoleById);

router.post("/", auth, rbac(["SUPERADMIN"]), validate(createRoleSchema), createRole);

router.patch("/:id", validateUuid("id"), auth, rbac(["SUPERADMIN"]), validate(updateRoleSchema), updateRole);

router.delete("/:id", validateUuid("id"), auth, rbac(["SUPERADMIN"]), deleteRole);

/* ------------------------------------------------------------------ */
/*                     MENU GROUPS ENDPOINTS                           */
/* ------------------------------------------------------------------ */

// (GET /menus is registered above, before "/:id" — see note there.)

router.get(
  "/menus/:id",
  validateUuid("id"),
  auth,
  rbac(["SUPERADMIN"]),
  getMenuById,
);

router.post("/menus", auth, rbac(["SUPERADMIN"]), validate(createMenuSchema), createMenu);

router.patch(
  "/menus/:id",
  validateUuid("id"),
  auth,
  rbac(["SUPERADMIN"]),
  updateMenu,
);

router.delete(
  "/menus/:id",
  validateUuid("id"),
  auth,
  rbac(["SUPERADMIN"]),
  deleteMenu,
);

/* ------------------------------------------------------------------ */

router.post(
  "/:roleId/permissions",
  auth,
  rbac(["SUPERADMIN"]),
  assignPermissionToRole,
);

router.delete(
  "/:roleId/permissions/:menuGroupId",
  auth,
  rbac(["SUPERADMIN"]),
  removePermissionFromRole,
);

/* ------------------------------------------------------------------ */
/*                     ROLE ASSIGNMENT ENDPOINTS                       */
/* ------------------------------------------------------------------ */

router.post(
  "/assign",
  auth,
  rbac(["SUPERADMIN"]),
  assignRoleToUser,
);

router.delete(
  "/assign/:userId",
  auth,
  rbac(["SUPERADMIN"]),
  removeRoleFromUser,
);

export = router;
