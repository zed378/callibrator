/**
 * User Permission Controller
 *
 * Manages per-user permission overrides (user_menu_permissions).
 * Users inherit permissions from their role; these endpoints let admins
 * grant or deny individual menus for a single user on top of that.
 */

const userPermissionService = require("../services/userPermission.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-41).
const { auditActor } = require("../utils/auditActor.util");

/** GET /api/v1/user-permissions/:userId */
exports.getUserPermissions = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const result = await userPermissionService.getUserPermissions(userId);
  success(res, result.data, null, result.message, result.status);
});

/** POST /api/v1/user-permissions/:userId */
exports.setUserPermission = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { menuGroupId, permissionType, notes } = req.body || {};

  if (!menuGroupId || !permissionType) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "menuGroupId and permissionType are required",
    });
  }

  const result = await userPermissionService.setUserPermission(
    userId,
    menuGroupId,
    permissionType,
    req.user?.id || null,
    notes || null,
    auditActor(req),
  );
  success(res, result.data, null, result.message, result.status);
});

/** DELETE /api/v1/user-permissions/:userId/:menuGroupId */
exports.removeUserPermission = asyncHandler(async (req, res) => {
  const { userId, menuGroupId } = req.params;
  const result = await userPermissionService.removeUserPermission(
    userId,
    menuGroupId,
    auditActor(req),
  );
  success(res, result.data, null, result.message, result.status);
});
