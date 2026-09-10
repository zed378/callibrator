// src/services/userService.js
const { Op, Sequelize } = require("sequelize");
const { db } = require("../config");
const { Users, Roles } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { hashPassword } = require("../utils/password.util");
const { deleteUpload, getUploadUrl } = require("../utils/upload.util");
const { AppError } = require("../utils/appError.util");
const {
  SUPER_ADMIN_ROLE_ID,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require("../constants");
const {
  validate: validateInput,
  formatErrors,
  createUserSchema,
  updateUserSchema,
  // The validator exports this as `updateRoleSchema` ({ userId, roleId }).
  updateRoleSchema: updateUserRoleSchema,
  checkUsernameSchema,
} = require("../validators/user.validator");

// The seeded system super-admin account is hidden from user listings by
// default. Overridable per-call (includeSystemAccount: true) or via env.
const SYSTEM_ACCOUNT_USERNAME = process.env.SYSTEM_ACCOUNT_USERNAME || "sys";
const SYSTEM_ACCOUNT_EMAIL =
  process.env.SYSTEM_ACCOUNT_EMAIL || "sys@mail.com";

// Permission assignment moved to role-based model (RoleMenuPermission)
// userMenuGrant.service removed - now using role_menu_permissions table directly

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = (data, schema) => {
  const { error, value } = validateInput(data, schema);
  if (error) {
    throw {
      status: 400,
      message: "Validation failed",
      errors: formatErrors(error.details),
    };
  }
  return value;
};

// ------------------------------------------------------------------
// Helper: build safe attribute list
// ------------------------------------------------------------------
// Safe user attributes exclude sensitive fields.
// Includes: picture (profile endpoint + profile string), username, first_name, last_name, email
const safeUserAttributes = {
  exclude: [
    "updatedAt",
    "otp_code",
    "otp_expired_at",
    "otp_request_count",
    "password",
    "otp_last_requested_at",
    "failed_login_attempts",
    "locked_until",
    "password_changed_at",
    "role_id",
  ],
};

// ------------------------------------------------------------------
// GET ALL USERS
// ------------------------------------------------------------------
exports.fetchUsers = async ({
  tenantId,
  roleFilter,
  role,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  includeSystemAccount = false,
}) => {
  let transaction;
  try {
    // Resolve role → roleId (if needed)
    let roleId = null;
    if (role && typeof role === "object" && role.id) {
      roleId = role.id;
    } else if (typeof role === "string") {
      const roleRecord = await Roles.findOne({
        where: { name: role },
        attributes: ["id"],
      });
      roleId = roleRecord ? roleRecord.id : null;
    }

    // Build WHERE clause
    const whereClause = {};

    // Tenant scoping – skip for SUPER_ADMIN
    if (roleId !== SUPER_ADMIN_ROLE_ID) {
      whereClause.tenantId = tenantId;
      whereClause.roleId = {
        [Op.notIn]: [SUPER_ADMIN_ROLE_ID],
      };
    }

    // Free-text search
    if (find && typeof find === "string" && find.trim() !== "") {
      const searchTerm = `%${find.toLowerCase()}%`;
      whereClause[Op.or] = [
        { username: { [Op.like]: searchTerm } },
        { firstName: { [Op.like]: searchTerm } },
        { lastName: { [Op.like]: searchTerm } },
        { email: { [Op.like]: searchTerm } },
      ];
    }

    // filter by role
    if (roleFilter && roleFilter !== SUPER_ADMIN_ROLE_ID) {
      whereClause.roleId = roleFilter;
    }

    // Always hide the seeded system account (username "sys" / sys@mail.com)
    // from user listings unless explicitly requested.
    if (!includeSystemAccount) {
      whereClause[Op.and] = [
        ...(whereClause[Op.and] || []),
        { username: { [Op.ne]: SYSTEM_ACCOUNT_USERNAME } },
        { email: { [Op.ne]: SYSTEM_ACCOUNT_EMAIL } },
      ];
    }

    // Pagination
    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Math.max(Number(page), 1) - 1) * safeLimit;

    transaction = await db.transaction();

    const data = await Users.findAndCountAll({
      attributes: safeUserAttributes,
      where: whereClause,
      order: [["firstName", "ASC"]],
      limit: safeLimit,
      offset: offset,
      include: [
        {
          model: Roles,
          as: "role",
          attributes: ["id", "name", "nameToShow", "description"],
        },
      ],
      transaction,
    });

    // Shape response
    const avatarBaseUrl = `${process.env.HOST_URL || ""}/uploads/profile/`;
    const rowsWithAvatars = data.rows.map((user) => {
      const plain = user.get();
      return {
        ...plain,
        avatarUrl: user.picture,
        picture: user.picture,
        first_name: user.first_name,
        last_name: user.last_name,
      };
    });

    const totalPages = Math.ceil(data.count / safeLimit);

    /* istanbul ignore else -- transaction is assigned from db.transaction()
       above, which either yields a transaction or throws (that throw path is
       covered separately), so it is always truthy here. */
    if (transaction) {
      await transaction.commit();
    }

    // Count users by status (single query with grouping)
    const statusCounts = { ACTIVE: 0, INACTIVE: 0, LOCKED: 0, SUSPENDED: 0 };
    try {
      const statusRows = await Users.findAll({
        attributes: [
          [Sequelize.col("status"), "status"],
          [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
        ],
        paranoid: false,
        group: ["status"],
        raw: true,
      });
      for (const row of statusRows) {
        if (statusCounts.hasOwnProperty(row.status)) {
          statusCounts[row.status] = parseInt(row.count, 10);
        }
      }
    } catch (statusErr) {
      logger.error("Failed to fetch user status counts", {
        error: statusErr.message,
        stack: statusErr.stack,
      });
    }

    return {
      success: true,
      status: 200,
      message: "Fetch users successful",
      data: {
        count: data.count,
        rows: rowsWithAvatars,
        avatarBaseUrl,
      },
      meta: {
        total: data.count,
        statusCounts,
        page: Number(page) || 1,
        limit: safeLimit,
        totalPages,
        hasNextPage: (Number(page) || 1) < totalPages,
        hasPrevPage: (Number(page) || 1) > 1,
      },
    };
  } catch (err) {
    if (transaction) {
      await transaction.rollback();
    }

    logger.error("Error fetching users", {
      err: err.message,
      stack: err.stack,
      tenantId,
      role: role && role.id ? role.id : role,
      find,
      page,
      limit,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC USER
// ------------------------------------------------------------------
exports.fetchSpecificUser = async (userId) => {
  try {
    const user = await Users.findByPk(userId, {
      attributes: safeUserAttributes,
      include: [
        {
          model: Roles,
          as: "role",
          attributes: ["id", "name", "nameToShow", "description"],
        },
      ],
    });

    if (!user) {
      throw {
        status: 404,
        message: "User not found",
      };
    }

    const plain = user.get();
    const avatarBaseUrl = `${process.env.HOST_URL || ""}/uploads/profile/`;

    return {
      success: true,
      status: 200,
      message: "Fetch user successful",
      data: {
        ...plain,
        avatarUrl: user.picture,
        picture: user.picture,
        first_name: user.first_name,
        last_name: user.last_name,
      },
    };
  } catch (err) {
    logger.error("Error fetching specific user", {
      err: err.message,
      stack: err.stack,
      userId,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// CHECK USERNAME AVAILABILITY
// ------------------------------------------------------------------
exports.checkUsernameAvailability = async (input) => {
  const { username } = input;

  try {
    const normalizedUsername = username.trim().toLowerCase();

    const existingUser = await Users.findOne({
      where: {
        username: {
          [Op.like]: normalizedUsername,
        },
      },
      attributes: ["id", "username"],
    });

    return {
      success: true,
      status: 200,
      message: existingUser
        ? "Username is already taken"
        : "Username is available",
      data: {
        username: normalizedUsername,
        available: !existingUser,
      },
    };
  } catch (err) {
    logger.error("Error checking username availability", {
      err: err.message,
      stack: err.stack,
      username,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE USER ROLE
// ------------------------------------------------------------------
exports.userRoleUpdate = async (input) => {
  const { userId, roleId, updatedBy } = validate(input, updateUserRoleSchema);
  const { actorIsSuperAdmin = false, actorTenantId = null } = input || {};

  let transaction;

  try {
    transaction = await db.transaction();

    const user = await Users.findByPk(userId, {
      include: [
        {
          model: Roles,
          as: "role",
          attributes: ["id", "name"],
        },
      ],
      transaction,
    });

    if (!user) {
      throw {
        status: 404,
        message: "User not found",
      };
    }

    // Tenant isolation: a non-super-admin may only modify users in their tenant.
    if (!actorIsSuperAdmin && String(user.tenantId) !== String(actorTenantId)) {
      throw {
        status: 403,
        message: "Access denied: resource belongs to a different tenant",
      };
    }

    const role = await Roles.findByPk(roleId, {
      transaction,
    });

    if (!role) {
      throw {
        status: 404,
        message: "Role not found",
      };
    }

    // Privilege-escalation guard: only a super-admin may grant the
    // SUPER_ADMIN role.
    if (
      !actorIsSuperAdmin &&
      (String(role.id) === String(SUPER_ADMIN_ROLE_ID) ||
        role.name === "SUPER_ADMIN" ||
        role.name === "SUPERADMIN")
    ) {
      throw {
        status: 403,
        message: "Forbidden: cannot assign the SUPER_ADMIN role",
      };
    }

    if (role.status !== "active") {
      throw {
        status: 400,
        message: "Cannot assign inactive role to user",
      };
    }

    if (user.role_id === role.id) {
      throw {
        status: 400,
        message: "User already has this role",
      };
    }

    await user.update(
      {
        roleId: role.id,
      },
      {
        transaction,
      },
    );

    await transaction.commit();

    // When role changes, user automatically inherits new role's menu
    // permissions from role_menu_permissions table. No separate reassignment needed.

    logger.info("User role updated", {
      userId: user.id,
      oldRoleId: user.roleId,
      newRoleId: role.id,
      updatedBy,
    });

    return {
      success: true,
      status: 200,
      message: "User role updated successfully",
      data: {
        userId: user.id,
        roleId: role.id,
        roleName: role.name,
      },
    };
  } catch (err) {
    if (transaction) {
      await transaction.rollback();
    }

    logger.error("Error updating user role", {
      err: err.message,
      stack: err.stack,
      userId,
      roleId,
      updatedBy,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// CREATE USER
// ------------------------------------------------------------------
exports.userCreate = async (input) => {
  const data = validate(input, createUserSchema);
  const {
    tenantId,
    username,
    firstName,
    lastName,
    email,
    password,
    roleId,
    status,
    createdBy,
  } = data;
  const { actorIsSuperAdmin = false, actorTenantId = null } = input || {};

  // Non-super-admins can only create users within their own tenant; the
  // client-supplied tenantId is ignored for them.
  const effectiveTenantId = actorIsSuperAdmin
    ? tenantId
    : actorTenantId || tenantId;

  let transaction;

  try {
    transaction = await db.transaction();

    const existingUsername = await Users.findOne({
      where: {
        username: {
          [Op.like]: username.trim().toLowerCase(),
        },
      },
      transaction,
    });

    if (existingUsername) {
      throw {
        status: 409,
        message: "Username already used",
      };
    }

    const existingEmail = await Users.findOne({
      where: {
        email: {
          [Op.like]: email.trim().toLowerCase(),
        },
      },
      transaction,
    });

    if (existingEmail) {
      throw {
        status: 409,
        message: "Email already registered",
      };
    }

    const role = await Roles.findByPk(roleId, {
      transaction,
    });

    if (!role) {
      throw {
        status: 404,
        message: "Role not found",
      };
    }

    // Privilege-escalation guard: only a super-admin may create a
    // SUPER_ADMIN account.
    if (
      !actorIsSuperAdmin &&
      (String(role.id) === String(SUPER_ADMIN_ROLE_ID) ||
        role.name === "SUPER_ADMIN" ||
        role.name === "SUPERADMIN")
    ) {
      throw {
        status: 403,
        message: "Forbidden: cannot create a SUPER_ADMIN account",
      };
    }

    if (role.status !== "active") {
      throw {
        status: 400,
        message: "Cannot assign inactive role to user",
      };
    }

    const hashedPassword = await hashPassword(password);

    const user = await Users.create(
      {
        tenantId: effectiveTenantId,
        username: username.trim(),
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role_id: roleId,
        status: status || "ACTIVE",
        is_email_verified: true,
      },
      {
        transaction,
      },
    );

    await transaction.commit();
    await transaction.finished;

    const existingUser = await Users.findByPk(user.id);
    if (!existingUser) {
      throw { status: 500, message: "User was not created successfully" };
    }

    // When a role is assigned to a user, they automatically inherit
    // the role's menu permissions from role_menu_permissions table.
    // No separate assignment needed.

    logger.info("User created", {
      userId: existingUser.id,
      username: existingUser.username,
      email: existingUser.email,
      roleId,
      createdBy,
    });

    return {
      success: true,
      status: 201,
      message: "User created successfully",
      data: {
        id: user.id,
        tenantId: user.tenantId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        roleId: user.roleId,
        roleName: role.name,
        roleDescription: role.description || null,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        picture: user.picture,
        avatarUrl: user.picture,
      },
    };
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    logger.error("Error creating user", {
      err: err.message,
      stack: err.stack,
      username,
      email,
      roleId,
      createdBy,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// EDIT USER
// ------------------------------------------------------------------
exports.editUser = async (input) => {
  const data = validate(input, updateUserSchema);
  const {
    userId,
    tenantId,
    username,
    firstName,
    lastName,
    email,
    status,
    isEmailVerified,
    is_active,
    updatedBy,
  } = data;
  const { actorIsSuperAdmin = false, actorTenantId = null } = input || {};

  let transaction;

  try {
    transaction = await db.transaction();

    const user = await Users.findByPk(userId, {
      transaction,
    });

    if (!user) {
      throw {
        status: 404,
        message: "User not found",
      };
    }

    // Tenant isolation: a non-super-admin may only edit users in their tenant.
    if (!actorIsSuperAdmin && String(user.tenantId) !== String(actorTenantId)) {
      throw {
        status: 403,
        message: "Access denied: resource belongs to a different tenant",
      };
    }

    if (username && username !== user.username) {
      const existingUsername = await Users.findOne({
        where: {
          username: {
            [Op.like]: username.trim().toLowerCase(),
          },
          id: {
            [Op.ne]: user.id,
          },
        },
        transaction,
      });

      if (existingUsername) {
        throw {
          status: 409,
          message: "Username already used",
        };
      }
    }

    if (email && email !== user.email) {
      const existingEmail = await Users.findOne({
        where: {
          email: {
            [Op.like]: email.trim().toLowerCase(),
          },
          id: {
            [Op.ne]: user.id,
          },
        },
        transaction,
      });

      if (existingEmail) {
        throw {
          status: 409,
          message: "Email already registered",
        };
      }
    }

    await user.update(
      {
        tenantId: tenantId !== undefined ? tenantId : user.tenantId,
        username: username !== undefined ? username.trim() : user.username,
        firstName: firstName !== undefined ? firstName?.trim() : user.firstName,
        lastName: lastName !== undefined ? lastName?.trim() : user.lastName,
        email: email !== undefined ? email.trim().toLowerCase() : user.email,
        status: status !== undefined ? status : user.status,
        isEmailVerified:
          isEmailVerified !== undefined
            ? isEmailVerified
            : user.isEmailVerified,
        isActive: is_active !== undefined ? is_active : user.is_active,
      },
      {
        transaction,
      },
    );

    await transaction.commit();

    logger.info("User updated", {
      userId: user.id,
      updatedBy,
    });

    return {
      success: true,
      status: 200,
      message: "User updated successfully",
      data: {
        id: user.id,
        tenantId: user.tenantId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        roleId: user.roleId,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        is_active: user.is_active,
        updatedAt: user.updatedAt,
        picture: user.picture,
        avatarUrl: user.picture,
      },
    };
  } catch (err) {
    if (transaction) {
      await transaction.rollback();
    }

    logger.error("Error updating user", {
      err: err.message,
      stack: err.stack,
      userId,
      updatedBy,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};

// ==========================================
// USER AVATAR UPLOAD FUNCTIONS
// ==========================================

/**
 * Update user avatar
 */
exports.updateUserAvatar = async (userId, filename, updatedBy) => {
  try {
    const user = await Users.findByPk(userId);

    if (!user) {
      throw new AppError(404, "User not found");
    }

    if (user.picture) {
      const oldFilename = user.picture.split("/").pop();
      if (oldFilename && oldFilename !== "default.svg") {
        try {
          await deleteUpload(oldFilename, "uploads/profile");
        } catch (err) {
          logger.warn(`Failed to delete old avatar: ${oldFilename}`, err);
        }
      }
    }

    // Must be the MODEL attribute (avatarUrl), not the column name
    // (avatar_url). Sequelize silently drops unknown keys, so writing the
    // snake_case name made this a no-op that still reported success.
    await user.update({ avatarUrl: filename }, { silent: true });

    logger.info(`User avatar updated: ${userId} by ${updatedBy}`);

    return {
      data: { avatar: filename },
      message: "User avatar updated successfully",
      status: 200,
    };
  } catch (error) {
    if (error.name === "AppError" || error.status) {
      throw error;
    }
    logger.error("Error updating user avatar", { error: error.message });
    throw new AppError(500, "Failed to update user avatar");
  }
};

/**
 * Remove user avatar
 */
exports.removeUserAvatar = async (userId, updatedBy) => {
  try {
    const user = await Users.findByPk(userId);

    if (!user) {
      throw new AppError(404, "User not found");
    }

    if (user.picture) {
      const filename = user.picture.split("/").pop();
      if (filename && filename !== "default.svg") {
        try {
          await deleteUpload(filename, "uploads/profile");
        } catch (err) {
          logger.warn(`Failed to delete avatar file: ${filename}`, err);
        }
      }

      // `picture` is a read-only getter over avatarUrl — writing it does
      // nothing. Reset the real attribute instead.
      await user.update({ avatarUrl: "default.svg" }, { silent: true });
      logger.info(`User avatar removed: ${userId} by ${updatedBy}`);
    }

    return {
      data: { avatar: "default.svg" },
      message: "User avatar removed successfully",
      status: 200,
    };
  } catch (error) {
    if (error.name === "AppError" || error.status) {
      throw error;
    }
    logger.error("Error removing user avatar", { error: error.message });
    throw new AppError(500, "Failed to remove user avatar");
  }
};

// ------------------------------------------------------------------
// DELETE USER
// ------------------------------------------------------------------
exports.deleteUser = async ({
  userId,
  deletedBy,
  actorIsSuperAdmin = false,
  actorTenantId = null,
}) => {
  try {
    if (!userId) {
      throw {
        status: 400,
        message: "User ID is required",
      };
    }

    const user = await Users.findByPk(userId, {
      include: [
        {
          model: Roles,
          as: "role",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!user) {
      throw {
        status: 404,
        message: "User not found",
      };
    }

    // The seeded default super-admin account can NEVER be deleted — not even by
    // another super admin.
    if (
      user.username === SYSTEM_ACCOUNT_USERNAME ||
      user.email === SYSTEM_ACCOUNT_EMAIL
    ) {
      throw {
        status: 403,
        message: "The default system administrator account cannot be deleted",
      };
    }

    // Tenant isolation: a non-super-admin may only delete users in their tenant.
    if (!actorIsSuperAdmin && String(user.tenantId) !== String(actorTenantId)) {
      throw {
        status: 403,
        message: "Access denied: resource belongs to a different tenant",
      };
    }

    // A non-super-admin must never be able to delete a SUPER_ADMIN account.
    if (
      !actorIsSuperAdmin &&
      (String(user.roleId) === String(SUPER_ADMIN_ROLE_ID) ||
        user.role?.name === "SUPER_ADMIN" ||
        user.role?.name === "SUPERADMIN")
    ) {
      throw {
        status: 403,
        message: "Forbidden: cannot delete a SUPER_ADMIN account",
      };
    }

    if (deletedBy && deletedBy === user.id) {
      throw {
        status: 400,
        message: "You cannot delete your own account",
      };
    }

    if (user.picture) {
      const avatarFilename = user.picture.split("/").pop();
      if (avatarFilename && avatarFilename !== "default.svg") {
        try {
          await deleteUpload(avatarFilename, "uploads/profile");
        } catch (err) {
          logger.warn(`Failed to delete user avatar: ${avatarFilename}`, err);
        }
      }
    }

    await user.destroy();

    logger.info("User deleted", {
      userId: user.id,
      username: user.username,
      deletedBy,
    });

    return {
      success: true,
      status: 200,
      message: "User deleted successfully",
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    };
  } catch (err) {
    logger.error("Error deleting user", {
      err: err.message,
      stack: err.stack,
      userId,
      deletedBy,
    });

    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};
