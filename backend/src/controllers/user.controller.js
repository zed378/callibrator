const userService = require("../services/user.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  createUserSchema,
  updateUserSchema,
  // The validator exports this as `updateRoleSchema` ({ userId, roleId }).
  updateRoleSchema: updateUserRoleSchema,
  usernameCheckSchema: checkUsernameSchema,
  userParamSchema,
  getAllUsersQuery,
  validate: validateUser,
  formatErrors,
} = require("../validators/user.validator");

/**
 * Handle validation error and send error response
 */
const handleValidation = (result, res, status = 400) => {
  if (result.error) {
    const err = new Error("Validation failed");
    err.status = status;
    err.errors = formatErrors(result.error.details);
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
const getActor = (req) => ({
  actorTenantId: req.user?.tenantId || null,
  actorIsSuperAdmin:
    req.user?.role?.name === "SUPER_ADMIN" ||
    req.user?.role?.name === "SUPERADMIN",
});

exports.getAllUsers = asyncHandler(async (req, res) => {
  const { error, value } = validateUser(req.query, getAllUsersQuery);
  if (error) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Validation failed",
      errors: formatErrors(error.details),
    });
  }

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
    validateUser(req.body, checkUsernameSchema),
    res,
  );
  const result = await userService.checkUsernameAvailability(validated);

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
    validateUser(req.body, updateUserRoleSchema),
    res,
  );
  const result = await userService.userRoleUpdate({
    ...validated,
    updatedBy: req.user.id,
    ...getActor(req),
  });

  success(res, result.data, null, result.message || "User role updated", 200);
});

exports.createUser = asyncHandler(async (req, res) => {
  const validated = handleValidation(
    validateUser(req.body, createUserSchema),
    res,
  );
  const result = await userService.userCreate({
    ...validated,
    createdBy: req.user.id || null,
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
    validateUser(req.body, updateUserSchema),
    res,
  );
  const result = await userService.editUser({
    ...validated,
    updatedBy: req.user.id || null,
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

exports.deleteUser = asyncHandler(async (req, res) => {
  const { error, value } = validateUser(req.query, userParamSchema);
  if (error) {
    return res.status(400).json({
      success: false,
      status: 400,
      message:
        "Validation failed - userId is required and must be a valid UUID",
      errors: formatErrors(error.details),
    });
  }

  const { userId } = value;
  const deletedBy = req.user.id || null;

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

exports.uploadUserAvatar = asyncHandler(async (req, res) => {
  const { userId } = { ...req.body, ...req.params };
  const updatedBy = req.user?.id;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "No file uploaded",
      data: null,
    });
  }

  const result = await userService.updateUserAvatar(
    userId,
    req.uploadFilename,
    updatedBy,
  );

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
  const updatedBy = req.user?.id;

  const result = await userService.removeUserAvatar(userId, updatedBy);

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
      },
    ],
    order: [["firstName", "ASC"]],
    raw: true,
    nest: true,
  });

  success(res, users, null, "Users fetched successfully", 200);
});
