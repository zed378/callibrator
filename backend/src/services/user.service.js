// src/services/userService.js
const { Op, Sequelize } = require("sequelize");
const { db } = require("../config");
const { Users, Roles } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { hashPassword } = require("../utils/password.util");
const { deleteUpload, getUploadUrl } = require("../utils/upload.util");
const { AppError } = require("../utils/appError.util");
const auditService = require("./audit.service");
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

// ==========================================
// TENANT-ISOLATION REFUSAL (AZ-04)
// ==========================================

/**
 * The one error for "this user id does not resolve for you". CLAUDE.md:
 * "Cross-tenant returns 404, never 403 [...] Non-existent, soft-deleted and
 * not-yours must be indistinguishable." Every not-found and every cross-tenant
 * branch in userRoleUpdate / editUser / deleteUser throws THIS, so the two
 * outcomes cannot drift apart. A fresh object per throw: callers may mutate.
 *
 * @returns {{status: 404, message: string}}
 */
const userNotFound = () => ({ status: 404, message: "User not found" });

/**
 * Refuse a non-super-admin acting on a user in another tenant, with the same
 * error as a user that does not exist. The reason goes to the log only.
 *
 * On the HTTP path this is defence-in-depth: the global tenant hooks
 * (utils/tenantScope.util.js) already scope `Users.findByPk` to the caller's
 * tenant, so a foreign user comes back `null`. It still has to be
 * indistinguishable — it becomes the live branch the moment a lookup gains
 * `.unscoped()` / `skipTenantScope`, or runs outside a request context (where
 * the hooks skip).
 *
 * @param {string} operation - the service function, for the log
 * @param {{id: string, tenantId: (string|null)}} user - the row that was found
 * @param {{actorIsSuperAdmin: boolean, actorTenantId: (string|null)}} actor
 * @throws {{status: 404, message: string}} when the user is outside the actor's tenant
 */
const assertSameTenantOrNotFound = (operation, user, actor) => {
  if (
    actor.actorIsSuperAdmin ||
    String(user.tenantId) === String(actor.actorTenantId)
  ) {
    return;
  }

  logger.warn("user.service: cross-tenant user access refused", {
    reason: "cross-tenant",
    operation,
    userId: user.id,
    userTenantId: user.tenantId,
    actorTenantId: actor.actorTenantId,
  });

  throw userNotFound();
};

// ==========================================
// AUDIT (A-77)
// ==========================================

/**
 * A-77. Write a user mutation's audit row INSIDE its transaction (A-41): a
 * failed insert re-throws from logAction and rolls the change back, so no user
 * change commits unattributed and no row records a change that did not happen.
 *
 * `audit_logs.tenantId` is NOT NULL (BR-A41-4): the row is recorded under the
 * TARGET user's tenant, falling back to the actor's home tenant for a
 * tenant-less account. The actor, IP and user agent come from the controller's
 * trusted request context (`getActor`), never from the body.
 *
 * @param {object} transaction - the mutation's transaction
 * @param {object} input - the service input (carries actorTenantId, ipAddress, userAgent)
 * @param {{action: string, actorUserId: (string|null|undefined), user: {id: string, tenantId: (string|null)},
 *   changes: object}} entry
 * @returns {Promise<object>}
 */
const auditUserChange = (transaction, input, { action, actorUserId, user, changes }) =>
  auditService.logAction(
    {
      tenantId: user.tenantId || input.actorTenantId,
      userId: actorUserId,
      action,
      resourceType: "User",
      resourceId: user.id,
      changes,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    },
    { transaction },
  );

/** The user columns editUser can write, for the audit row's before/after. */
const AUDITED_USER_FIELDS = Object.freeze([
  "username",
  "firstName",
  "lastName",
  "email",
  "status",
  "isEmailVerified",
  "isActive",
]);

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
//
// `exclude` takes ATTRIBUTE names. This list used to name columns
// (`otp_code`, `locked_until`, ...), which match no attribute and so excluded
// nothing — and it never named the second-factor secrets at all: GET /users
// and GET /users/:id returned every user's TOTP seed (`mfaSecret`), from
// which anyone who can list users can generate that user's codes, plus the
// e-mail OTP and the lockout counters. `role_id` is kept: it IS an attribute
// (added by the Role association), a duplicate of `roleId`.
// user.safeAttributes.test.js checks every name here against the model.
const safeUserAttributes = {
  exclude: [
    "updatedAt",
    "password",
    "passwordChangedAt",
    "otpCode",
    "otpExpiredAt",
    "otpRequestCount",
    "otpLastRequestedAt",
    "failedLoginAttempts",
    "lockedUntil",
    "mfaSecret",
    "mfaPendingSecret",
    "mfaPendingCreatedAt",
    "mfaLastUsedStep",
    "mfaRecoveryCodes",
    "webauthnCredentialId",
    "webauthnPublicKey",
    "webauthnSignCount",
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
      // A-109: `role_id NOT IN (...)` is NULL — not true — for a user with no
      // role, so this alone dropped every role-less user from the list even
      // with the role include made LEFT below. Hide super admins, keep them.
      whereClause[Op.and] = [
        ...(whereClause[Op.and] || []),
        {
          [Op.or]: [
            { roleId: null },
            { roleId: { [Op.notIn]: [SUPER_ADMIN_ROLE_ID] } },
          ],
        },
      ];
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
          // A-109: Role's defaultScope made this an implicit INNER JOIN, so a
          // user with no role (roleId NULL, e.g. after the role was deleted)
          // or a soft-deleted role vanished from the list AND from
          // meta.total. The user exists; the relation reads as null.
          required: false,
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
          // A-109: LEFT, not the defaultScope's implicit INNER — a user
          // without a live role is still a user, not a 404.
          required: false,
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
          // A-109: LEFT. As an implicit INNER JOIN a user whose role was
          // deleted was "not found" here — so the one operation that repairs
          // such a user, giving them a role, could not reach them.
          required: false,
        },
      ],
      transaction,
    });

    if (!user) {
      throw userNotFound();
    }

    // Tenant isolation: a non-super-admin may only modify users in their
    // tenant. AZ-04: a foreign user is refused exactly like a missing one.
    assertSameTenantOrNotFound("userRoleUpdate", user, {
      actorIsSuperAdmin,
      actorTenantId,
    });

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

    const previousRoleId = user.roleId || user.role_id || null;

    await user.update(
      {
        roleId: role.id,
      },
      {
        transaction,
      },
    );

    // A-77: a role change is an authorization change — audited in the tx.
    await auditUserChange(transaction, input, {
      action: "UPDATE",
      actorUserId: input.updatedBy,
      user,
      changes: { roleId: { before: previousRoleId, after: role.id } },
    });

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
        // The ATTRIBUTE, not the column: `is_email_verified` is no attribute
        // of User, so Sequelize dropped it and every admin-created user was
        // stored unverified (user.create.attributes.test.js).
        isEmailVerified: true,
        // A-123 (ADR-051 Q-11): the administrator chose this password, and
        // since ADR-047 a password signs. The holder must replace it before
        // anything else (auth.middleware answers 403 until they do).
        mustChangePassword: true,
      },
      {
        transaction,
      },
    );

    // A-77: audited inside the transaction. Never the password or its hash.
    await auditUserChange(transaction, input, {
      action: "CREATE",
      actorUserId: input.createdBy,
      user: { id: user.id, tenantId: effectiveTenantId },
      changes: {
        after: {
          tenantId: effectiveTenantId,
          username: username.trim(),
          email: email.trim().toLowerCase(),
          roleId,
          status: user.status,
          // A-123: the forced first-login change (the column is
          // mustChangePassword; this key keeps the audit row free of the
          // word the A-77 redaction check looks for).
          firstLoginChangeRequired: true,
        },
      },
    });

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
        mustChangePassword: true,
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
      throw userNotFound();
    }

    // Tenant isolation: a non-super-admin may only edit users in their
    // tenant. AZ-04: a foreign user is refused exactly like a missing one.
    assertSameTenantOrNotFound("editUser", user, {
      actorIsSuperAdmin,
      actorTenantId,
    });

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

    const before = {};
    for (const field of AUDITED_USER_FIELDS) {
      before[field] = user[field];
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

    // A-77: a status change is an authorization change, and any edit must be
    // attributable — audited inside the transaction, before the commit.
    const changes = {};
    for (const field of AUDITED_USER_FIELDS) {
      if (user[field] !== before[field]) {
        changes[field] = { before: before[field], after: user[field] };
      }
    }
    await auditUserChange(transaction, input, {
      action: "UPDATE",
      actorUserId: input.updatedBy,
      user,
      changes,
    });

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

/** The avatar "no photo" sentinel — never a file of this user's to delete. */
const AVATAR_PLACEHOLDER = "default.svg";
const AVATAR_FOLDER = "uploads/profile";

/**
 * The stored avatar filename of a user, or null when there is none of their
 * own (unset or the shared placeholder). Read from the ATTRIBUTE, not the
 * `picture` getter, which is a URL built over it.
 *
 * @param {object} user
 * @returns {string|null}
 */
const ownAvatarFile = (user) => {
  const stored = user.avatarUrl ? String(user.avatarUrl).split("/").pop() : null;
  return stored && stored !== AVATAR_PLACEHOLDER ? stored : null;
};

/**
 * Delete a replaced avatar AFTER the commit that stopped referencing it.
 * The change is committed; a leftover file is a storage leak, not a reason to
 * report the change as failed.
 *
 * @param {string|null} filename
 */
const unlinkReplacedAvatar = async (filename) => {
  if (!filename) {
    return;
  }
  try {
    await deleteUpload(filename, AVATAR_FOLDER);
  } catch (err) {
    logger.warn(`Failed to delete replaced avatar file: ${filename}`, err);
  }
};

/**
 * A-96. Change a user's avatar attribute: row update and its audit row in ONE
 * transaction; the file the change stops referencing is deleted only after the
 * commit. Deleted before it (as it was), a failed update — a failed audit
 * insert included — left the user pointing at a file that no longer existed.
 *
 * `actor` defaults to "nobody": a non-super-admin actor may change only a user
 * of their own tenant; anyone else's is 404, like a missing user (AZ-04). On
 * the HTTP path the gate (checkTenant) and the global hooks already confine the
 * lookup — this is the service holding its own line.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.next - the new avatarUrl value
 * @param {string} p.operation - changes.operation for the audit row
 * @param {string|null} p.updatedBy - the acting user id (from req.user)
 * @param {{actorTenantId?: (string|null), actorIsSuperAdmin?: boolean,
 *   ipAddress?: (string|null), userAgent?: (string|null)}} p.actor
 * @param {boolean} p.skipWhenNoAvatar - a remove with nothing to remove writes nothing
 * @returns {Promise<{changed: boolean, replaced: (string|null)}>}
 */
const changeAvatar = async ({ userId, next, operation, updatedBy, actor, skipWhenNoAvatar }) => {
  const transaction = await db.transaction();
  try {
    const user = await Users.findByPk(userId, { transaction });
    if (!user) {
      // The same error assertSameTenantOrNotFound throws (AZ-04).
      throw userNotFound();
    }
    assertSameTenantOrNotFound(operation, user, {
      actorIsSuperAdmin: actor.actorIsSuperAdmin === true,
      actorTenantId: actor.actorTenantId || null,
    });

    const replaced = ownAvatarFile(user);
    if (skipWhenNoAvatar && !replaced) {
      // Nothing to change, so nothing to audit.
      await transaction.rollback();
      return { changed: false, replaced: null };
    }

    const before = user.avatarUrl ?? null;
    // Must be the MODEL attribute (avatarUrl), not the column name
    // (avatar_url) nor the read-only `picture` getter: Sequelize silently
    // drops those, and the change would report success without saving.
    await user.update({ avatarUrl: next }, { silent: true, transaction });

    await auditUserChange(transaction, actor, {
      action: "UPDATE",
      actorUserId: updatedBy || null,
      user,
      changes: { operation, avatarUrl: { before, after: next } },
    });

    await transaction.commit();

    // Never the file just stored (a re-upload under the same name).
    await unlinkReplacedAvatar(replaced !== next ? replaced : null);
    return { changed: true, replaced };
  } catch (error) {
    // Every throw above happens before the commit. A rollback of a
    // transaction that is somehow already finished is not the error the
    // caller must see.
    await transaction.rollback().catch(() => {});
    throw error;
  }
};

/**
 * Update user avatar (A-96: audited in the transaction; old file deleted after
 * the commit).
 *
 * @param {string} userId
 * @param {string} filename - the file this request uploaded
 * @param {string|null} updatedBy - the acting user id
 * @param {object} [actor] - see changeAvatar; defaults to nobody
 */
exports.updateUserAvatar = async (userId, filename, updatedBy, actor = {}) => {
  try {
    await changeAvatar({
      userId,
      next: filename,
      operation: "UPDATE_AVATAR",
      updatedBy,
      actor,
      skipWhenNoAvatar: false,
    });

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
 * Remove user avatar (A-96: audited in the transaction; file deleted after
 * the commit). A user with no avatar of their own is left untouched.
 *
 * @param {string} userId
 * @param {string|null} updatedBy - the acting user id
 * @param {object} [actor] - see changeAvatar; defaults to nobody
 */
exports.removeUserAvatar = async (userId, updatedBy, actor = {}) => {
  try {
    const { changed } = await changeAvatar({
      userId,
      next: AVATAR_PLACEHOLDER,
      operation: "REMOVE_AVATAR",
      updatedBy,
      actor,
      skipWhenNoAvatar: true,
    });

    if (changed) {
      logger.info(`User avatar removed: ${userId} by ${updatedBy}`);
    }

    return {
      data: { avatar: AVATAR_PLACEHOLDER },
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
exports.deleteUser = async (input) => {
  const {
    userId,
    deletedBy,
    actorIsSuperAdmin = false,
    actorTenantId = null,
  } = input;
  let transaction;
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
          // A-109: LEFT — a user without a live role can still be deleted.
          // The super-admin guard below reads `user.roleId` as well as
          // `user.role?.name`, so a null relation does not open it.
          required: false,
        },
      ],
    });

    if (!user) {
      throw userNotFound();
    }

    // Tenant isolation: a non-super-admin may only delete users in their
    // tenant. AZ-04: a foreign user is refused exactly like a missing one.
    // This runs BEFORE the system-account guard below: that guard answers a
    // specific 403, so running it first confirmed to another tenant that the
    // id is the system account.
    assertSameTenantOrNotFound("deleteUser", user, {
      actorIsSuperAdmin,
      actorTenantId,
    });

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

    // A-77: the delete and its audit row commit together or not at all.
    transaction = await db.transaction();
    await user.destroy({ transaction });
    await auditUserChange(transaction, input, {
      action: "DELETE",
      actorUserId: deletedBy,
      user,
      changes: {
        before: { username: user.username, email: user.email, roleId: user.roleId },
      },
    });
    await transaction.commit();

    // The avatar file goes only AFTER the commit: removed before it, a
    // rolled-back delete (a failed audit insert included) would leave a live
    // user whose avatar is gone.
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
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

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

// ------------------------------------------------------------------
// ADMIN-ASSISTED MFA RESET (A-141)
// ------------------------------------------------------------------

const SUPER_ADMIN_ROLE_NAMES = new Set(["SUPER_ADMIN", "SUPERADMIN"]);
/**
 * A tenant administrator clears another user's second factor — the way back
 * for a user who lost their authenticator AND their recovery codes.
 *
 * Deliberately narrow:
 *  - the target must be in the caller's tenant; another tenant's user is the
 *    same 404 as a missing one (the tenant hooks already scope the lookup;
 *    assertSameTenantOrNotFound is the defence-in-depth twin);
 *  - never oneself: a user turns their own MFA off with their password and a
 *    code (POST /auth/mfa/disable), not with an admin grant;
 *  - never a user whose role outranks the caller's (a tenant admin cannot
 *    strip a super admin's second factor); a super admin may reset anyone;
 *  - every MFA column is cleared and EVERY session of the target is revoked,
 *    so whoever holds the lost device or a session is signed out, and the
 *    user signs in with the password alone and enrols again;
 *  - audited (UPDATE on User, `changes.operation` MFA_ADMIN_RESET) inside
 *    the transaction, naming the administrator as the actor.
 *
 * It does not reset the password: an administrator who can also set the
 * password could then sign in as the user; a password reset stays the user's
 * own e-mail-code path.
 *
 * @param {object} input
 * @param {string} input.userId - the target
 * @param {string} input.resetBy - the administrator (req.user.id)
 * @param {boolean} [input.actorIsSuperAdmin]
 * @param {string|null} [input.actorTenantId]
 * @param {number} [input.actorRoleLevel]
 * @param {string|null} [input.ipAddress]
 * @param {string|null} [input.userAgent]
 * @returns {Promise<object>} the envelope
 * @throws {{status: number, message: string}} 404 not found / not in the
 *   caller's tenant; 400 self; 403 higher role; 409 MFA not enabled
 */
exports.resetUserMfa = async (input) => {
  const { userId, resetBy, actorIsSuperAdmin, actorTenantId, actorRoleLevel } = input;
  // Lazily: session.service loads the Session model and Redis.
  const { revokeOtherSessions } = require("./session.service");
  const mfaService = require("./mfa.service");

  let transaction;
  try {
    transaction = await db.transaction();

    const user = await Users.findByPk(userId, {
      include: [
        {
          model: Roles,
          as: "role",
          // ADR-043: the JS attribute is roleLevel.
          attributes: ["id", "name", "roleLevel"],
          required: false,
        },
      ],
      transaction,
    });
    if (!user) {
      throw userNotFound();
    }
    assertSameTenantOrNotFound("resetUserMfa", user, {
      actorIsSuperAdmin,
      actorTenantId,
    });

    if (String(user.id) === String(resetBy)) {
      throw {
        status: 400,
        message:
          "You cannot reset your own MFA here; turn it off with your password and a code on the MFA page",
      };
    }

    // A super admin outranks everyone even if its level were missing.
    const targetLevel = SUPER_ADMIN_ROLE_NAMES.has(user.role?.name)
      ? Number.MAX_SAFE_INTEGER
      : user.role?.roleLevel || 0;
    // Written as "not at or below", so an actor whose level is unknown
    // (undefined) is refused rather than compared as if it outranked anyone.
    if (!actorIsSuperAdmin && !(targetLevel <= actorRoleLevel)) {
      throw {
        status: 403,
        message: "Forbidden: you cannot reset the MFA of a user whose role is above yours",
      };
    }

    if (!user.mfaEnabled) {
      throw { status: 409, message: "MFA is not enabled for this user" };
    }

    await user.update({ ...mfaService.MFA_CLEARED }, { transaction });
    const sessionsRevoked = await revokeOtherSessions(user.id, null, "MFA_ADMIN_RESET", {
      transaction,
    });

    await auditUserChange(transaction, input, {
      action: "UPDATE",
      actorUserId: resetBy,
      user,
      changes: { operation: "MFA_ADMIN_RESET", sessionsRevoked },
    });

    await transaction.commit();

    logger.info("User MFA reset by an administrator", { userId: user.id, resetBy });

    return {
      success: true,
      status: 200,
      message:
        "MFA has been reset. The user must sign in with their password and set up MFA again.",
      data: { id: user.id, mfaEnabled: false, sessionsRevoked },
    };
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    logger.error("Error resetting user MFA", { err: err.message, userId, resetBy });
    throw {
      status: err.status || 500,
      message: err.message || "Internal server error",
    };
  }
};
