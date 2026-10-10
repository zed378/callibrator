/**
 * User Permission Controller
 *
 * Manages per-user permission overrides (user_menu_permissions).
 * Users inherit permissions from their role; these endpoints let admins
 * grant or deny individual menus for a single user on top of that.
 *
 * P9-20 (ADR-087): converted from userPermission.controller.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). The service is the module object;
 * `asyncHandler`, `success` and `auditActor` are captured at load, as the `.js`
 * destructured them. Request data is read through typed views of the request
 * (`req.params`, `req.body`, `req.user`), so the emitted expressions are the
 * `.js` ones.
 */
import type { Request, Response } from "express";

import userPermissionService from "../services/userPermission.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-41).
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditActor = loadedAuditActor;

/** The path parameters the route validated (`validateUuid`). */
interface UserParams extends Record<string, string> {
  userId: UserId;
}

/** The override the body names. */
interface SetPermissionBody {
  menuGroupId?: string;
  permissionType?: string;
  notes?: string | null;
}

/** The caller `auth` put on the request. */
interface Caller {
  id?: UserId | null;
}

/** GET /api/v1/user-permissions/:userId */
const getUserPermissions = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as UserParams;
  const result = await userPermissionService.getUserPermissions(userId);
  success(res, result.data, null, result.message, result.status);
});

/** POST /api/v1/user-permissions/:userId */
const setUserPermission = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as UserParams;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}` (Express 5 leaves no body undefined)
  const { menuGroupId, permissionType, notes } = (req.body as SetPermissionBody | undefined) || {};

  if (!menuGroupId || !permissionType) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "menuGroupId and permissionType are required",
      data: null,
    });
  }

  const result = await userPermissionService.setUserPermission(
    userId,
    menuGroupId,
    permissionType,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as null
    (req.user as Caller | undefined)?.id || null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: empty notes read as null
    notes || null,
    auditActor(req),
  );
  success(res, result.data, null, result.message, result.status);
  return undefined;
});

/** DELETE /api/v1/user-permissions/:userId/:menuGroupId */
const removeUserPermission = asyncHandler(async (req: Request, res: Response) => {
  const { userId, menuGroupId } = req.params as UserParams & { menuGroupId: string };
  const result = await userPermissionService.removeUserPermission(
    userId,
    menuGroupId,
    auditActor(req),
  );
  success(res, result.data, null, result.message, result.status);
});

const controller = {
  getUserPermissions,
  setUserPermission,
  removeUserPermission,
};

export = controller;
