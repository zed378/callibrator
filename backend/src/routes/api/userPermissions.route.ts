/**
 * Per-user permission overrides: `/api/v1/user-permissions` (index.js mounts
 * it). Super admin only.
 *
 * P9-21 (ADR-087): converted from userPermissions.route.js. Every route, gate
 * and middleware is in the same order as before, `validateUuid` still BEFORE
 * `auth` (checked against the mounted route table). The contract is
 * code-first: userPermissions.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import userPermissionController from "../../controllers/userPermission.controller";
import { auth } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/:userId",
  validateUuid("userId"),
  auth,
  rbac(["SUPERADMIN"]),
  userPermissionController.getUserPermissions,
);

router.post(
  "/:userId",
  validateUuid("userId"),
  auth,
  rbac(["SUPERADMIN"]),
  userPermissionController.setUserPermission,
);

router.delete(
  "/:userId/:menuGroupId",
  validateUuid("userId", "menuGroupId"),
  auth,
  rbac(["SUPERADMIN"]),
  userPermissionController.removeUserPermission,
);

export = router;
