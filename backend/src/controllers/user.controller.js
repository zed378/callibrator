const userService = require("../services/user.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
// A-282 (ADR-100): the audit actor. For an API key, req.user.id is the KEY's id,
// which audit_logs.user_id (a foreign key to users) cannot hold: the key is
// recorded as system:api-key, with its id in changes.apiKeyId.
const { auditPrincipal } = require("../utils/auditPrincipal.util");
const { isSuperAdmin } = require("../utils/role.util");
const {
  createUserSchema,
  updateUserSchema,
  updateProfileSchema,
  // The validator exports this as `updateRoleSchema` ({ userId, roleId }).
  updateRoleSchema: updateUserRoleSchema,
  usernameCheckSchema: checkUsernameSchema,
  userParamSchema,
  getAllUsersQuery,
} = require("../validators/user.validator");
const { checkInput } = require("../validators/input");

/**
 * Handle validation error and send error response
 */
const handleValidation = (result, res, status = 400) => {
  if (!result.ok) {
    const err = new Error("Validation failed");
    err.status = status;
    err.errors = result.errors;
    err.name = "ValidationError";
    throw err;
  }
  return result.value;
};

/**
 * Derive trusted actor context from the authenticated user.
 * Tenant scope and privilege are taken from the verified token/session,
 * never from client-supplied query/body values.
 */
const getActor = (req) => {
  // A-77: the IP and user agent go into the audit row the service writes
  // inside its transaction. A-282: so does the API key that acted, if one did.
  const { ipAddress, userAgent, apiKeyId } = auditPrincipal(req);
  return {
    actorTenantId: req.user?.tenantId || null,
    actorIsSuperAdmin: isSuperAdmin(req.user),
    ipAddress,
    userAgent,
    apiKeyId,
  };
};

/** A-282: the acting USER's id — null for an API key, whose id is no user. */
const actingUserId = (req) => auditPrincipal(req).userId;

exports.getAllUsers = asyncHandler(async (req, res) => {
  const checked = checkInput(req.query, getAllUsersQuery);
  if (!checked.ok) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Validation failed",
      errors: checked.errors,
    });
  }
  const { value } = checked;

  const role = req.user.role;
  const { actorIsSuperAdmin, actorTenantId } = getActor(req);

  // Non-super-admins are locked to their own tenant regardless of any
  // client-supplied tenantId (prevents cross-tenant enumeration / BOLA).
  const effectiveTenantId = actorIsSuperAdmin ? value.tenantId : actorTenantId;

  const result = await userService.fetchUsers({
    tenantId: effectiveTenantId,
    roleFilter: value.roleFilter,
    role,
    find: value.find,
    page: value.page,
    limit: value.limit,
  });

  success(
    res,
    result.data.rows || result.data,
    result.meta,
    result.message || "Fetch users successful",
    result.status || 200,
  );
});

exports.getSpecificUser = asyncHandler(async (req, res) => {
  const { userId } = { ...req.body, ...req.params };

  const result = await userService.fetchSpecificUser(userId);
  success(
    res,
    result.data,
    null,
    result.message || "Fetch user successful",
    result.status || 200,
  );
});

exports.checkUsernameAvailability = asyncHandler(async (req, res) => {
  const validated = handleValidation(
    checkInput(req.body, checkUsernameSchema),
    res,
  );
  // A-258: the probe answers what userCreate would, so it carries the same
  // actor — its "taken" answers are counted and audited as A-128 conflicts.
  const result = await userService.checkUsernameAvailability({
    ...validated,
    actorId: actingUserId(req),
    ...getActor(req),
  });

  success(
    res,
    result.data,
    null,
    result.message || "Username availability checked",
    200,
  );
});

exports.updateUserRole = asyncHandler(async (req, res) => {
  const validated = handleValidation(
    checkInput(req.body, updateUserRoleSchema),
    res,
  );
  const result = await userService.userRoleUpdate({
    ...validated,
    updatedBy: actingUserId(req),
    ...getActor(req),
  });

  success(res, result.data, null, result.message || "User role updated", 200);
});

exports.createUser = asyncHandler(async (req, res) => {
  const validated = handleValidation(
    checkInput(req.body, createUserSchema),
    res,
  );
  const result = await userService.userCreate({
    ...validated,
    createdBy: actingUserId(req),
    ...getActor(req),
  });

  success(
    res,
    result.data,
    null,
    result.message || "User created successfully",
    result.status || 201,
  );
});

exports.editUser = asyncHandler(async (req, res) => {
  const validated = handleValidation(
    checkInput(req.body, updateUserSchema),
    res,
  );
  const result = await userService.editUser({
    ...validated,
    updatedBy: actingUserId(req),
    ...getActor(req),
  });

  success(
    res,
    result.data,
    null,
    result.message || "User updated successfully",
    result.status || 200,
  );
});

/**
 * A-63. PATCH /users/:userId/profile — edit a user's own profile fields.
 *
 * The target comes from the PATH, and the path param wins over any body
 * `userId`, so the id the `checkSelf` gate compared is the id edited. Only
 * username / firstName / lastName reach the service (updateProfileSchema).
 */
exports.updateProfile = asyncHandler(async (req, res) => {
  const validated = handleValidation(
    checkInput({ ...req.body, userId: req.params.userId }, updateProfileSchema),
    res,
  );
  const result = await userService.editUser({
    ...validated,
    updatedBy: actingUserId(req),
    ...getActor(req),
  });

  success(
    res,
    result.data,
    null,
    result.message || "Profile updated successfully",
    result.status || 200,
  );
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const checked = checkInput(req.query, userParamSchema);
  if (!checked.ok) {
    return res.status(400).json({
      success: false,
      status: 400,
      message:
        "Validation failed - userId is required and must be a valid UUID",
      errors: checked.errors,
    });
  }
  const { value } = checked;

  const { userId } = value;
  const deletedBy = actingUserId(req);

  const result = await userService.deleteUser({
    userId,
    deletedBy,
    ...getActor(req),
  });

  success(
    res,
    result.data,
    null,
    result.message || "User deleted successfully",
    200,
  );
});

/**
 * A-96. Remove the avatar file THIS request uploaded, after the service
 * refused or failed. Never throws: the original error is what the caller must
 * see.
 *
 * @param {import("express").Request} req
 */
const discardUploadedAvatar = async (req) => {
  try {
    await require("../utils/upload.util").deleteUpload(req.uploadFilename, "uploads/public/profile");
  } catch (deleteErr) {
    require("../middlewares/activityLog.middleware").logger.warn(
      `Failed to delete uploaded avatar after failure: ${req.uploadFilename}`,
      deleteErr,
    );
  }
};

exports.uploadUserAvatar = asyncHandler(async (req, res) => {
  // The PATH names the user (the gate checked it); a body userId never wins.
  const { userId } = { ...req.body, ...req.params };
  const updatedBy = actingUserId(req);

  if (!req.file) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "No file uploaded",
      data: null,
    });
  }

  let result;
  try {
    // A-96: the service audits inside its transaction and throws for every
    // refusal BEFORE the commit — so a throw means the upload belongs to
    // nobody and must not stay on disk.
    result = await userService.updateUserAvatar(
      userId,
      req.uploadFilename,
      updatedBy,
      getActor(req),
    );
  } catch (err) {
    await discardUploadedAvatar(req);
    throw err;
  }

  success(
    res,
    result.data,
    null,
    result.message || "User avatar uploaded successfully",
    result.status || 200,
  );
});

exports.removeUserAvatar = asyncHandler(async (req, res) => {
  const { userId } = { ...req.body, ...req.params };
  const updatedBy = actingUserId(req);

  const result = await userService.removeUserAvatar(userId, updatedBy, getActor(req));

  success(
    res,
    result.data,
    null,
    result.message || "User avatar removed successfully",
    result.status || 200,
  );
});

exports.getAllUsersSimple = asyncHandler(async (req, res) => {
  const { Users, Roles } = require("../models");

  const users = await Users.findAll({
    attributes: ["id", "username", "firstName", "lastName", "email", "roleId"],
    include: [
      {
        model: Roles,
        as: "role",
        attributes: ["id", "name", "description"],
        // A-109: LEFT — the defaultScope's implicit INNER JOIN left users
        // without a live role out of every picker built on this list.
        required: false,
      },
    ],
    order: [["firstName", "ASC"]],
    raw: true,
    nest: true,
  });

  success(res, users, null, "Users fetched successfully", 200);
});

/**
 * A-141. POST /users/:userId/mfa/reset — a tenant administrator clears
 * another user's second factor. The target comes from the PATH; tenant,
 * privilege and role level come from the authenticated principal, never the
 * body.
 */
exports.resetUserMfa = asyncHandler(async (req, res) => {
  const result = await userService.resetUserMfa({
    userId: req.params.userId,
    resetBy: req.user.id,
    // rbac() ran first and refused a principal without a role.
    actorRoleLevel: req.user.role.roleLevel,
    ...getActor(req),
  });

  success(res, result.data, null, result.message, result.status);
});

/**
 * A-262. DELETE /users/:userId/webauthn — a tenant administrator removes
 * another user's passkey. The target comes from the PATH; tenant, privilege
 * and role level come from the authenticated principal, never the body.
 */
exports.resetUserPasskey = asyncHandler(async (req, res) => {
  const result = await userService.resetUserPasskey({
    userId: req.params.userId,
    resetBy: req.user.id,
    // rbac() ran first and refused a principal without a role.
    actorRoleLevel: req.user.role.roleLevel,
    ...getActor(req),
  });

  success(res, result.data, null, result.message, result.status);
});

/**
 * A-162. POST /users/:userId/password/reset — a tenant administrator replaces
 * another user's password with a temporary one, shown once. The target comes
 * from the PATH; tenant, privilege and role level from the authenticated
 * principal, never the body. The response carries a credential: it must not
 * be cached anywhere on the way back.
 */
exports.resetUserPassword = asyncHandler(async (req, res) => {
  const result = await userService.resetUserPassword({
    userId: req.params.userId,
    resetBy: req.user.id,
    // rbac() ran first and refused a principal without a role.
    actorRoleLevel: req.user.role.roleLevel,
    ...getActor(req),
  });

  res.setHeader("Cache-Control", "no-store");
  success(res, result.data, null, result.message, result.status);
});
