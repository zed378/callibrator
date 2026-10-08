/**
 * User administration: list, read, create, edit and delete accounts; avatars;
 * the administrator-assisted MFA, passkey and password resets; and the A-128
 * identity-conflict rules shared with SCIM.
 *
 * P9-12 (ADR-087 Amendment 14): converted from user.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order). This service throws plain
 * `{ status, message }` objects, which its controllers read; that is kept
 * (the file-level `only-throw-error` exemption below).
 *
 * Compiler-exposed: A-295 (`user.is_active`), kept as built by the conversion and
 * fixed in its own change (the attribute is `isActive`).
 */
/* eslint-disable @typescript-eslint/only-throw-error -- as built: this service throws { status, message } objects, which the controllers and asyncHandler read */
import { Op, Sequelize, type InferAttributes, type InferCreationAttributes, type Transaction, type WhereOptions } from "sequelize";
import { db } from "../config";
import models from "../models";
import { logger } from "../middlewares/activityLog.middleware";
import { hashPassword } from "../utils/password.util";
import { deleteUpload } from "../utils/upload.util";
import { AppError } from "../utils/appError.util";
import auditService from "./audit.service";
import rateLimiter from "./rateLimiter.redis.service";
import { isPlatformTenant } from "../constants/platformTenant";
import {
  SUPER_ADMIN_ROLE_ID,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "../constants";
import {
  createUserSchema,
  updateUserSchema,
  // The validator exports this as `updateRoleSchema` ({ userId, roleId }).
  updateRoleSchema as updateUserRoleSchema,
} from "../validators/user.validator";
import { validateInput as validate } from "../validators/input";
import { envOr } from "../config/env";
import { actorChanges, auditEntryActor } from "../utils/auditPrincipal.util";
import type { z } from "zod";
import type * as CryptoModule from "crypto";
import type { AuditAction } from "../constants/auditActions";
import type { ModelInstance } from "../types/models";
import type SessionServiceModule from "./session.service";
import type MfaServiceModule from "./mfa.service";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdminRoleName, SUPER_ADMIN_ROLE_NAMES } from "../utils/role.util";

const { Users, Roles } = models;
const { checkAuthLockout, recordAuthFailure } = rateLimiter;

type UserRow = ModelInstance<"User">;

/** Sequelize's run-time `transaction.finished` ("commit" / "rollback"), which its typings omit. */
const finishedOf = (transaction: Transaction): unknown => (transaction as unknown as { finished?: unknown }).finished;

/** What these functions read of a caught value (the JavaScript read these properties directly). */
interface ErrorLike {
  message?: string;
  stack?: string;
  status?: number;
  name?: string;
  identityConflict?: IdentityField;
  fields?: Record<string, unknown> | null;
}

/** The two identity fields A-128 guards. */
type IdentityField = "username" | "email";

/** The request context every mutation carries (the controllers' getActor). */
interface ActorContext {
  /** A-282: the API key that acted, when one did (its id is no user's). */
  apiKeyId?: string | null;
  actorIsSuperAdmin?: boolean;
  actorTenantId?: string | null;
  actorRoleLevel?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** A plain `{ status, message }` refusal, as this service throws them. */
interface ServiceError {
  status: number;
  message: string;
}

/** The service's own response object (the controllers pass it through). */
interface UserServiceResponse {
  success: true;
  status: number;
  message: string;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/** The actor side of a user a guard is checked against. */
interface TenantGuardActor {
  actorIsSuperAdmin: boolean;
  actorTenantId: string | null;
}

/** A mutation's input: the validated fields plus the controller's actor context. */
type MutationInput = ActorContext & Record<string, unknown>;

// The seeded system super-admin account is hidden from user listings by
// default. Overridable per-call (includeSystemAccount: true) or via env.
const SYSTEM_ACCOUNT_USERNAME = envOr("SYSTEM_ACCOUNT_USERNAME", "sys");
const SYSTEM_ACCOUNT_EMAIL =
  envOr("SYSTEM_ACCOUNT_EMAIL", "sys@mail.com");

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
const userNotFound = (): ServiceError => ({ status: 404, message: "User not found" });

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
const assertSameTenantOrNotFound = (
  operation: string,
  user: { id: string; tenantId: string | null },
  actor: TenantGuardActor,
): void => {
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
const auditUserChange = (
  transaction: Transaction,
  input: ActorContext,
  {
    action,
    actorUserId,
    user,
    changes,
  }: {
    action: AuditAction;
    actorUserId: string | null | undefined;
    user: { id: string; tenantId: string | null | undefined };
    changes: Record<string, unknown>;
  },
): Promise<unknown> =>
  auditService.logAction(
    {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
      tenantId: user.tenantId || input.actorTenantId,
      // A-282: a key acts as system:api-key, named in changes.apiKeyId; a user as that user.
      ...auditEntryActor({
        userId: actorUserId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means absent */
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      }),
      action,
      resourceType: "User",
      resourceId: user.id,
      changes: { ...changes, ...actorChanges({ apiKeyId: input.apiKeyId ?? null }) },
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
] as const);

type AuditedUserField = (typeof AUDITED_USER_FIELDS)[number];

// ------------------------------------------------------------------
// A-128 (ADR-051 Q-18) — IDENTITY CONFLICTS, THE RESIDUAL ORACLE
// ------------------------------------------------------------------
// Account identity is GLOBAL: `users.username` and `users.email` are unique
// across tenants (user.model.js), and Q-18 keeps it that way for now. So a
// tenant administrator who creates a user — or renames one — with an identity
// another tenant holds must be refused, and the refusal tells them that the
// identity exists somewhere. Q-18 accepts that residual oracle, reachable only
// by tenant administrators, on two conditions, implemented here:
//   - RATE-LIMITED: a budget of conflicts per administrator per window
//     (rateLimitConstants.js `userIdentityConflict`); past it, every create and
//     every identity-changing edit by that administrator is refused with 429
//     BEFORE anything is looked up, so a spent budget learns nothing.
//   - AUDITED: each conflict is a row in the administrator's tenant, written in
//     its own transaction (the create's own transaction has rolled back).
// A super admin reads every tenant anyway, so for them a conflict discloses
// nothing: neither counted nor audited.
//
// The check is GLOBAL (skipTenantScope) and includes soft-deleted accounts
// (paranoid: false), because the unique index does both. It used to be
// tenant-scoped: another tenant's holder passed the check and the insert failed
// on the index with a 500 — the same oracle, unlimited and unaudited. It is an
// exact, case-insensitive match: it used to be a LIKE on the raw input, where
// `_` and `%` are wildcards — as a global probe, "does any tenant have an
// address like %@hospital-b.example" would have been answered.
//
// Neither the 409 nor the audit row says WHICH tenant, or whether it was this
// one: the row is readable by this tenant's administrators, and the in-tenant
// case is visible to them in their own user list anyway.
const IDENTITY_CONFLICT_ENDPOINT = "userIdentityConflict";

const IDENTITY_CONFLICT_MESSAGES = Object.freeze({
  username: "Username already used",
  email: "Email already registered",
});

/** @param {"username"|"email"} field */
const identityConflict = (field: IdentityField): ServiceError & { identityConflict: IdentityField } => ({
  status: 409,
  message: IDENTITY_CONFLICT_MESSAGES[field],
  identityConflict: field,
});

/** `value` as a LIKE pattern that matches only itself (PostgreSQL's default ESCAPE is a backslash). */
const likeLiteral = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

/**
 * Throw the 409 when any account — any tenant, soft-deleted included — holds
 * `value` as its `field`, compared case-insensitively.
 *
 * @param {"username"|"email"} field
 * @param {string} value
 * @param {{excludeId?: string, transaction: object}} options
 */
const assertIdentityFree = async (
  field: IdentityField,
  value: string,
  { excludeId, transaction }: { excludeId?: string; transaction?: Transaction },
): Promise<void> => {
  // The `is_deleted` COLUMN key replaces the defaultScope's (see below), as built.
  const where: Record<string | symbol, unknown> = {
    [field]: { [Op.iLike]: likeLiteral(value.trim()) },
    // A soft-deleted account still holds its username and email in the
    // unique index. The defaultScope pins `is_deleted = false` under that
    // COLUMN key; the same key given here replaces it (paranoid: false
    // below does the same for deleted_at).
    is_deleted: { [Op.in]: [true, false] },
    ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
  };
  const holder = await Users.findOne({
    where: where as WhereOptions<InferAttributes<UserRow>>,
    attributes: ["id"],
    paranoid: false,
    // A-128: deliberately global — as the unique index this predicts is.
    skipTenantScope: true,
    // skipFacilityScope: the unique index is global, so a bound user editing its own profile must
    // meet every holder, not only its facility's (P21-09; FACILITY_SCOPE_SKIPS). Only `id` is read.
    skipFacilityScope: true,
    // `undefined` keeps the CLS transaction (not null); the cast is for exactOptionalPropertyTypes.
    transaction: transaction as Transaction,
  });
  if (holder) {
    throw identityConflict(field);
  }
};

/**
 * A-128 — refuse an administrator whose conflict budget is spent. Runs before
 * any lookup. A super admin is not limited.
 *
 * @param {object} input - the service input (actor fields from getActor)
 * @param {string} actorId
 */
const assertConflictBudget = async (input: ActorContext, actorId: string | null | undefined): Promise<void> => {
  if (input.actorIsSuperAdmin) {
    return;
  }
  // A-282: the budget belongs to the credential that probed — the user, or the key.
  const lockout = await checkAuthLockout({ userId: actorId ?? input.apiKeyId ?? null, endpoint: IDENTITY_CONFLICT_ENDPOINT });
  if (lockout.locked) {
    throw {
      status: 429,
      message:
        "Too many usernames or email addresses that were already registered. " +
        "Try again later, or ask the person which address they use with Callibrator.",
    };
  }
};

/**
 * A-128 — the conflict a non-super-admin was just answered with, counted
 * against their budget and audited in their tenant. The row names the field,
 * never the value, and never whose it was.
 *
 * @param {object} input - the service input
 * @param {{actorId: string, field: string, action: string, resourceId: (string|null),
 *   outcome?: string}} conflict - `outcome` is "refused" for a create or edit,
 *   "reported_taken" for the username probe (A-258)
 */
const recordIdentityConflict = async (
  input: ActorContext,
  {
    actorId,
    field,
    action,
    resourceId,
    outcome = "refused",
  }: { actorId: string | null | undefined; field: IdentityField; action: AuditAction; resourceId: string | null | undefined; outcome?: string },
): Promise<void> => {
  if (input.actorIsSuperAdmin) {
    return;
  }
  await recordAuthFailure({ userId: actorId ?? input.apiKeyId ?? null, endpoint: IDENTITY_CONFLICT_ENDPOINT });
  await db.transaction((transaction) =>
    auditService.logAction(
      {
        tenantId: input.actorTenantId,
        // A-282: a key acts as system:api-key, named in changes.apiKeyId.
        ...auditEntryActor({
          userId: actorId ?? null,
          apiKeyId: input.apiKeyId ?? null,
          /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means absent */
          ipAddress: input.ipAddress || null,
          userAgent: input.userAgent || null,
          /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
        }),
        action,
        resourceType: "User",
        resourceId,
        changes: { operation: "IDENTITY_CONFLICT", outcome, field, ...actorChanges({ apiKeyId: input.apiKeyId ?? null }) },
      },
      { transaction },
    ),
  );
  logger.warn("User identity conflict refused (A-128)", {
    actorId,
    tenantId: input.actorTenantId,
    field,
    action,
  });
};

/**
 * A-128 — the identity conflict an error stands for: one thrown by
 * assertIdentityFree, or a unique violation on username/email from a create or
 * update that raced past it. Null for anything else.
 *
 * @param {object} err
 * @returns {"username"|"email"|null}
 */
const conflictFieldOf = (err: ErrorLike): IdentityField | null => {
  if (err.identityConflict) {
    return err.identityConflict;
  }
  if (err.name !== "SequelizeUniqueConstraintError") {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
  const fields = Object.keys(err.fields || {});
  if (fields.includes("email")) {
    return "email";
  }
  return fields.includes("username") ? "username" : null;
};

// Permission assignment moved to role-based model (RoleMenuPermission)
// userMenuGrant.service removed - now using role_menu_permissions table directly

// ==========================================
// VALIDATION HELPERS
// ==========================================

// (validateInput is imported above as `validate`.)

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
// e-mail OTP and the lockout counters. `role_id` is no longer listed: it was
// a duplicate of `roleId` added by the Role association (A-148), and is gone.
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
  ],
};

// ------------------------------------------------------------------
// GET ALL USERS
// ------------------------------------------------------------------
/** fetchUsers' query, as the controller passes it. */
interface FetchUsersQuery {
  // P9-20: `undefined` admitted, as the validated query gives it (type-only).
  tenantId?: string | null | undefined;
  roleFilter?: string | null | undefined;
  role?: unknown;
  find?: unknown;
  page?: number | string;
  limit?: number | string;
  includeSystemAccount?: boolean;
}

const fetchUsers = async ({
  tenantId,
  roleFilter,
  role,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  includeSystemAccount = false,
}: FetchUsersQuery): Promise<UserServiceResponse> => {
  let transaction: Transaction | undefined;
  try {
    // Resolve role → roleId (if needed)
    let roleId: unknown = null;
    if (role && typeof role === "object" && (role as { id?: unknown }).id) {
      roleId = (role as { id?: unknown }).id;
    } else if (typeof role === "string") {
      const roleRecord = await Roles.findOne({
        where: { name: role },
        attributes: ["id"],
      });
      roleId = roleRecord ? roleRecord.id : null;
    }

    // Build WHERE clause (attribute keys and Op symbols, as built)
    const whereClause: Record<string | symbol, unknown> = {};

    // Tenant scoping – skip for SUPER_ADMIN
    if (roleId !== SUPER_ADMIN_ROLE_ID) {
      whereClause["tenantId"] = tenantId;
      // A-109: `role_id NOT IN (...)` is NULL — not true — for a user with no
      // role, so this alone dropped every role-less user from the list even
      // with the role include made LEFT below. Hide super admins, keep them.
      whereClause[Op.and] = [
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
        ...((whereClause[Op.and] as unknown[] | undefined) || []),
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
      whereClause["roleId"] = roleFilter;
    }

    // Always hide the seeded system account (username "sys" / sys@mail.com)
    // from user listings unless explicitly requested.
    if (!includeSystemAccount) {
      whereClause[Op.and] = [
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
        ...((whereClause[Op.and] as unknown[] | undefined) || []),
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
      where: whereClause as WhereOptions<InferAttributes<UserRow>>,
      order: [["firstName", "ASC"], ["id", "ASC"]],
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
    const avatarBaseUrl = `${envOr("HOST_URL", "")}/uploads/public/profile/`;
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

    // A-32: `transaction` was assigned by db.transaction() above (or it threw),
    // so the `if (transaction)` guard that sat here was unreachable.
    await transaction.commit();

    // Count users by status (single query with grouping)
    const statusCounts: Record<string, number> = { ACTIVE: 0, INACTIVE: 0, LOCKED: 0, SUSPENDED: 0 };
    try {
      const statusRows = (await Users.findAll({
        attributes: [
          [Sequelize.col("status"), "status"],
          [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
        ],
        paranoid: false,
        group: ["status"],
        raw: true,
        // raw: true answers plain `{ status, count }` rows, not model instances.
      })) as unknown as { status: string; count: string }[];
      for (const row of statusRows) {
        if (statusCounts.hasOwnProperty(row.status)) {
          statusCounts[row.status] = parseInt(row.count, 10);
        }
      }
    } catch (caught) {
      const statusErr = caught as ErrorLike;
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
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction) {
      await transaction.rollback();
    }

    logger.error("Error fetching users", {
      err: err.message,
      stack: err.stack,
      tenantId,
      role: role && (role as { id?: unknown }).id ? (role as { id?: unknown }).id : role,
      find,
      page,
      limit,
    });

    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC USER
// ------------------------------------------------------------------
const fetchSpecificUser = async (userId: string): Promise<UserServiceResponse> => {
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
    // As built: an avatarBaseUrl was computed here and never read (fetchUsers returns one).

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
  } catch (caught) {
    const err = caught as ErrorLike;
    logger.error("Error fetching specific user", {
      err: err.message,
      stack: err.stack,
      userId,
    });

    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// CHECK USERNAME AVAILABILITY
// ------------------------------------------------------------------
/**
 * Whether a username is free, for the create-user form.
 *
 * A-258 — this was a `LIKE` on the raw input under the tenant hooks, while
 * `users.username` is unique ACROSS tenants: a name held by another tenant
 * (or by a soft-deleted account) was reported "available" and the create then
 * failed; and a case variant ("Alice" for "alice") was "available" too. It now
 * asks exactly the question userCreate's own check asks —
 * assertIdentityFree("username"): the same scope, the same soft-delete rule,
 * an exact, case-insensitive match — so the probe and the create can never
 * disagree, whatever Q-18 settles the uniqueness scope to be (that function is
 * the one place it is encoded).
 *
 * Because the answer can disclose that another tenant holds a name, a "taken"
 * answer to a tenant administrator is the A-128 residual oracle and is treated
 * as one: the conflict budget is checked BEFORE the lookup (429 once spent, so
 * a spent budget learns nothing) and each "taken" is counted and audited, as a
 * refused create is. A super admin is neither limited nor audited.
 *
 * @param {{username: string, actorId?: string, actorTenantId?: string,
 *   actorIsSuperAdmin?: boolean, ipAddress?: string, userAgent?: string}} input
 * @returns {Promise<object>} the envelope; `data.available`
 */
const checkUsernameAvailability = async (
  input: ActorContext & { username: string; actorId?: string | null },
): Promise<UserServiceResponse> => {
  const { username, actorId } = input;

  try {
    const normalizedUsername = username.trim().toLowerCase();

    await assertConflictBudget(input, actorId);

    let available = true;
    try {
      await assertIdentityFree("username", normalizedUsername, {});
    } catch (caught) {
      const err = caught as ErrorLike;
      if (!err.identityConflict) {
        throw err;
      }
      available = false;
      await recordIdentityConflict(input, {
        actorId,
        field: "username",
        action: "CREATE",
        resourceId: null,
        outcome: "reported_taken",
      });
    }

    return {
      success: true,
      status: 200,
      message: available ? "Username is available" : "Username is already taken",
      data: {
        username: normalizedUsername,
        available,
      },
    };
  } catch (caught) {
    const err = caught as ErrorLike;
    logger.error("Error checking username availability", {
      err: err.message,
      stack: err.stack,
      username,
    });

    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// UPDATE USER ROLE
// ------------------------------------------------------------------
const userRoleUpdate = async (input: MutationInput & { updatedBy?: string | null }): Promise<UserServiceResponse> => {
  // `updatedBy` is not in the schema, so it is always undefined here (the audit row reads input.updatedBy).
  const { userId, roleId, updatedBy } = validate(input, updateUserRoleSchema) as z.output<typeof updateUserRoleSchema> & { updatedBy?: undefined };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `input || {}`
  const { actorIsSuperAdmin = false, actorTenantId = null } = input || {};

  let transaction: Transaction | undefined;

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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: both sides normalised
      (String(role.id) === String(SUPER_ADMIN_ROLE_ID) ||
        isSuperAdminRoleName(role.name))
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

    if (user.roleId === role.id) { // the attribute; `role_id` is gone (A-148)
      throw {
        status: 400,
        message: "User already has this role",
      };
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    const previousRoleId = user.roleId || null;

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
  } catch (caught) {
    const err = caught as ErrorLike;
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
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// CREATE USER
// ------------------------------------------------------------------
const userCreate = async (input: MutationInput & { createdBy?: string | null }): Promise<UserServiceResponse> => {
  // `createdBy` is not in the schema, so it is always undefined here (see below: input.createdBy).
  const data = validate(input, createUserSchema) as z.output<typeof createUserSchema> & { createdBy?: undefined };
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `input || {}`
  const { actorIsSuperAdmin = false, actorTenantId = null } = input || {};

  // Non-super-admins can only create users within their own tenant; the
  // client-supplied tenantId is ignored for them. A-125 follow-up: it used to
  // be `actorTenantId || tenantId`, so a non-super-admin with NO tenant took
  // the tenant from the BODY — any tenant, the PLATFORM one included. Such a
  // caller is now refused, as is one whose own tenant is PLATFORM (only a
  // super admin, naming it explicitly, may place an account there).
  const effectiveTenantId = actorIsSuperAdmin ? tenantId : actorTenantId;

  let transaction: Transaction | undefined;

  try {
    if (!actorIsSuperAdmin && (!actorTenantId || isPlatformTenant(actorTenantId))) {
      throw {
        status: 403,
        message: "Forbidden: your account cannot create users",
      };
    }

    // A-128: a spent conflict budget is refused before anything is looked up.
    // `input.createdBy`, not the validated `createdBy`: the schema strips it.
    await assertConflictBudget(input, input.createdBy);

    transaction = await db.transaction();

    // A-128: global and exact — see assertIdentityFree.
    await assertIdentityFree("username", username, { transaction });
    await assertIdentityFree("email", email, { transaction });

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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: both sides normalised
      (String(role.id) === String(SUPER_ADMIN_ROLE_ID) ||
        isSuperAdminRoleName(role.name))
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
    // A-215: the administrator's password expires (TEMPORARY_PASSWORD_TTL_MS).
    const temporaryPasswordExpiresAt = temporaryPasswordExpiry();

    // As built: `tenantId` may be undefined (none given) and a blank name is written as null.
    const values = {
      tenantId: effectiveTenantId,
      username: username.trim(),
      /* eslint-disable @typescript-eslint/no-unnecessary-condition -- as built: a blank name is stored as null */
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      // The ATTRIBUTE. Since the User -> Role association's foreignKey
      // became "roleId" (A-88 shape), `role_id` is no attribute of User and
      // Sequelize dropped it: every admin-created account was stored with
      // NO role (user.create.attributes.test.js).
      roleId,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
      status: status || "ACTIVE",
      // The ATTRIBUTE, not the column: `is_email_verified` is no attribute
      // of User, so Sequelize dropped it and every admin-created user was
      // stored unverified (user.create.attributes.test.js).
      isEmailVerified: true,
      // A-123 (ADR-051 Q-11): the administrator chose this password, and
      // since ADR-047 a password signs. The holder must replace it before
      // anything else (auth.middleware answers 403 until they do).
      mustChangePassword: true,
      temporaryPasswordExpiresAt,
    };
    // P10-16 (ADR-099 Amendment 1): the administrator's password signs in ONCE.
    const user = await Users.create(values as InferCreationAttributes<UserRow>, {
      transaction,
      oneTimePassword: true,
    });

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
          // A-215: when the administrator's password stops signing in.
          firstLoginChangeDeadline: temporaryPasswordExpiresAt.toISOString(),
        },
      },
    });

    await transaction.commit();
    await finishedOf(transaction);

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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
        roleDescription: role.description || null,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        mustChangePassword: true,
        temporaryPasswordExpiresAt,
        createdAt: user.createdAt,
        picture: user.picture,
        avatarUrl: user.picture,
      },
    };
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction && !finishedOf(transaction)) {
      await transaction.rollback();
    }

    // A-128: a conflict is a 409, counted and audited — including a unique
    // violation that raced past the check (it used to be a 500).
    const conflictField = conflictFieldOf(err);
    if (conflictField) {
      await recordIdentityConflict(input, {
        actorId: input.createdBy,
        field: conflictField,
        action: "CREATE",
        resourceId: null,
      });
      throw { status: 409, message: IDENTITY_CONFLICT_MESSAGES[conflictField] };
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
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// EDIT USER
// ------------------------------------------------------------------
const editUser = async (input: MutationInput & { updatedBy?: string | null }): Promise<UserServiceResponse> => {
  // `tenantId`, `isEmailVerified`, `is_active` and `updatedBy` are not in the
  // schema, so they are always undefined here, as built (A-295).
  const data = validate(input, updateUserSchema) as z.output<typeof updateUserSchema> & {
    tenantId?: undefined;
    isEmailVerified?: undefined;
    is_active?: undefined;
    updatedBy?: undefined;
  };
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `input || {}`
  const { actorIsSuperAdmin = false, actorTenantId = null } = input || {};

  let transaction: Transaction | undefined;

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

    // A-128: an identity change is the same probe as a create — budgeted,
    // global and exact (assertIdentityFree), and audited when refused.
    const usernameChanges = Boolean(username && username !== user.username);
    const emailChanges = Boolean(email && email !== user.email);
    if (usernameChanges || emailChanges) {
      await assertConflictBudget(input, input.updatedBy);
    }
    if (usernameChanges) {
      // usernameChanges holds only when `username` is a non-empty string.
      await assertIdentityFree("username", username as string, { excludeId: user.id, transaction });
    }
    if (emailChanges) {
      // emailChanges holds only when `email` is a non-empty string.
      await assertIdentityFree("email", email as string, { excludeId: user.id, transaction });
    }

    const before: Partial<Record<AuditedUserField, unknown>> = {};
    for (const field of AUDITED_USER_FIELDS) {
      before[field] = user[field];
    }

    /* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-nullish-coalescing -- as built: updateUserSchema strips tenantId / isEmailVerified / is_active, so these always take the row's value (A-295) */
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
        // A-295: the attribute (it read `user.is_active`, always undefined; Sequelize
        // dropped that from the UPDATE, so the column was never changed).
        isActive: is_active !== undefined ? is_active : user.isActive,
      },
      {
        transaction,
      },
    );
    /* eslint-enable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-nullish-coalescing */

    // A-77: a status change is an authorization change, and any edit must be
    // attributable — audited inside the transaction, before the commit.
    const changes: Partial<Record<AuditedUserField, { before: unknown; after: unknown }>> = {};
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
        // A-295: the attribute (the response used to answer undefined, dropping the key).
        is_active: user.isActive,
        updatedAt: user.updatedAt,
        picture: user.picture,
        avatarUrl: user.picture,
      },
    };
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction) {
      await transaction.rollback();
    }

    // A-128: as in userCreate.
    const conflictField = conflictFieldOf(err);
    if (conflictField) {
      await recordIdentityConflict(input, {
        actorId: input.updatedBy,
        field: conflictField,
        action: "UPDATE",
        resourceId: userId,
      });
      throw { status: 409, message: IDENTITY_CONFLICT_MESSAGES[conflictField] };
    }

    logger.error("Error updating user", {
      err: err.message,
      stack: err.stack,
      userId,
      updatedBy,
    });

    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ==========================================
// USER AVATAR UPLOAD FUNCTIONS
// ==========================================

/** The avatar "no photo" sentinel — never a file of this user's to delete. */
const AVATAR_PLACEHOLDER = "default.svg";
const AVATAR_FOLDER = "uploads/public/profile";

/**
 * The stored avatar filename of a user, or null when there is none of their
 * own (unset or the shared placeholder). Read from the ATTRIBUTE, not the
 * `picture` getter, which is a URL built over it.
 *
 * @param {object} user
 * @returns {string|null}
 */
const ownAvatarFile = (user: { avatarUrl?: unknown }): string | null => {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: String() of the stored value
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
const unlinkReplacedAvatar = async (filename: string | null): Promise<void> => {
  if (!filename) {
    return;
  }
  try {
    await deleteUpload(filename, AVATAR_FOLDER);
  } catch (caught) {
    const err = caught as ErrorLike;
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
/** changeAvatar's parameters (see above). */
interface AvatarChange {
  userId: string;
  next: string;
  operation: string;
  updatedBy: string | null | undefined;
  actor: ActorContext;
  skipWhenNoAvatar: boolean;
}

const changeAvatar = async ({
  userId,
  next,
  operation,
  updatedBy,
  actor,
  skipWhenNoAvatar,
}: AvatarChange): Promise<{ changed: boolean; replaced: string | null }> => {
  const transaction = await db.transaction();
  try {
    const user = await Users.findByPk(userId, { transaction });
    if (!user) {
      // The same error assertSameTenantOrNotFound throws (AZ-04).
      throw userNotFound();
    }
    assertSameTenantOrNotFound(operation, user, {
      actorIsSuperAdmin: actor.actorIsSuperAdmin === true,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
      actorTenantId: actor.actorTenantId || null,
    });

    const replaced = ownAvatarFile(user);
    if (skipWhenNoAvatar && !replaced) {
      // Nothing to change, so nothing to audit.
      await transaction.rollback();
      return { changed: false, replaced: null };
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `?? null`
    const before = user.avatarUrl ?? null;
    // Must be the MODEL attribute (avatarUrl), not the column name
    // (avatar_url) nor the read-only `picture` getter: Sequelize silently
    // drops those, and the change would report success without saving.
    await user.update({ avatarUrl: next }, { silent: true, transaction });

    await auditUserChange(transaction, actor, {
      action: "UPDATE",
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
      actorUserId: updatedBy || null,
      user,
      changes: { operation, avatarUrl: { before, after: next } },
    });

    await transaction.commit();

    // Never the file just stored (a re-upload under the same name).
    await unlinkReplacedAvatar(replaced !== next ? replaced : null);
    return { changed: true, replaced };
  } catch (caught) {
    const error = caught as ErrorLike;
    // Every throw above happens before the commit. A rollback of a
    // transaction that is somehow already finished is not the error the
    // caller must see.
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is not the error to report
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
const updateUserAvatar = async (
  userId: string,
  filename: string,
  updatedBy: string | null | undefined,
  actor: ActorContext = {},
): Promise<{ data: { avatar: string }; message: string; status: number }> => {
  try {
    await changeAvatar({
      userId,
      next: filename,
      operation: "UPDATE_AVATAR",
      updatedBy,
      actor,
      skipWhenNoAvatar: false,
    });

    logger.info(`User avatar updated: ${userId} by ${String(updatedBy)}`);

    return {
      data: { avatar: filename },
      message: "User avatar updated successfully",
      status: 200,
    };
  } catch (caught) {
    const error = caught as ErrorLike;
    if (error.name === "AppError" || error.status) {
      throw caught;
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
const removeUserAvatar = async (
  userId: string,
  updatedBy: string | null | undefined,
  actor: ActorContext = {},
): Promise<{ data: { avatar: string }; message: string; status: number }> => {
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
      logger.info(`User avatar removed: ${userId} by ${String(updatedBy)}`);
    }

    return {
      data: { avatar: AVATAR_PLACEHOLDER },
      message: "User avatar removed successfully",
      status: 200,
    };
  } catch (caught) {
    const error = caught as ErrorLike;
    if (error.name === "AppError" || error.status) {
      throw caught;
    }
    logger.error("Error removing user avatar", { error: error.message });
    throw new AppError(500, "Failed to remove user avatar");
  }
};

// ------------------------------------------------------------------
// DELETE USER
// ------------------------------------------------------------------
const deleteUser = async (
  input: ActorContext & { userId?: string; deletedBy?: string | null },
): Promise<UserServiceResponse> => {
  const {
    userId,
    deletedBy,
    actorIsSuperAdmin = false,
    actorTenantId = null,
  } = input;
  let transaction: Transaction | undefined;
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: both sides normalised
      (String(user.roleId) === String(SUPER_ADMIN_ROLE_ID) ||
        isSuperAdminRoleName(user.role?.name))
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
          await deleteUpload(avatarFilename, "uploads/public/profile");
        } catch (caught) {
          const err = caught as ErrorLike;
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
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction && !finishedOf(transaction)) {
      await transaction.rollback();
    }

    logger.error("Error deleting user", {
      err: err.message,
      stack: err.stack,
      userId,
      deletedBy,
    });

    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// ADMIN-ASSISTED MFA RESET (A-141)
// ------------------------------------------------------------------

// N-01: SUPER_ADMIN_ROLE_NAMES comes from utils/role.util.ts.

/**
 * The target of an administrator's credential reset (A-141 MFA, A-162
 * password), after the guards both share:
 *  - in the caller's tenant, or the same 404 as a missing user;
 *  - not the caller (400, `selfMessage`);
 *  - not a user whose role outranks the caller's (403); a super admin
 *    outranks everyone, and an actor whose level is unknown is refused.
 *
 * @param {object} transaction
 * @param {object} params
 * @returns {Promise<object>} the target user row, with `role`
 * @throws {{status: number, message: string}}
 */
/** loadAdminResetTarget's parameters (see above). */
interface ResetTargetQuery {
  operation: string;
  userId: string;
  resetBy: string;
  actorIsSuperAdmin: boolean | undefined;
  actorTenantId: string | null | undefined;
  actorRoleLevel: number | undefined;
  selfMessage: string;
  what: string;
}

const loadAdminResetTarget = async (
  transaction: Transaction,
  { operation, userId, resetBy, actorIsSuperAdmin, actorTenantId, actorRoleLevel, selfMessage, what }: ResetTargetQuery,
): Promise<UserRow> => {
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
  assertSameTenantOrNotFound(operation, user, {
    // As built: the reset callers pass these through as they came (undefined included).
    actorIsSuperAdmin: actorIsSuperAdmin as boolean,
    actorTenantId: actorTenantId as string | null,
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: both sides normalised
  if (String(user.id) === String(resetBy)) {
    throw { status: 400, message: selfMessage };
  }

  // A super admin outranks everyone even if its level were missing.
  const targetLevel = SUPER_ADMIN_ROLE_NAMES.has(user.role?.name as string)
    ? Number.MAX_SAFE_INTEGER
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    : user.role?.roleLevel || 0;
  // Written as "not at or below", so an actor whose level is unknown
  // (undefined) is refused rather than compared as if it outranked anyone.
  if (!actorIsSuperAdmin && !(targetLevel <= (actorRoleLevel as number))) {
    throw {
      status: 403,
      message: `Forbidden: you cannot reset the ${what} of a user whose role is above yours`,
    };
  }
  return user;
};
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
 * It does not reset the password. That is a separate, separately audited
 * action (resetUserPassword, A-162); the password alone does not pass a
 * second factor, so resetting both is two deliberate steps, not one.
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
const resetUserMfa = async (input: ActorContext & { userId: string; resetBy: string }): Promise<UserServiceResponse> => {
  const { userId, resetBy, actorIsSuperAdmin, actorTenantId, actorRoleLevel } = input;
  // Lazily: session.service loads the Session model and Redis.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const { revokeOtherSessions } = require("./session.service") as typeof SessionServiceModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const mfaService = require("./mfa.service") as typeof MfaServiceModule;

  let transaction;
  try {
    transaction = await db.transaction();

    const user = await loadAdminResetTarget(transaction, {
      operation: "resetUserMfa",
      userId,
      resetBy,
      actorIsSuperAdmin,
      actorTenantId,
      actorRoleLevel,
      selfMessage:
        "You cannot reset your own MFA here; turn it off with your password and a code on the MFA page",
      what: "MFA",
    });

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
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction && !finishedOf(transaction)) {
      await transaction.rollback();
    }
    logger.error("Error resetting user MFA", { err: err.message, userId, resetBy });
    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// ADMIN-ASSISTED PASSKEY REMOVAL (A-262)
// ------------------------------------------------------------------

/**
 * A tenant administrator removes another user's passkey — for a lost or
 * compromised authenticator, and for the SSO-only user, who has no password
 * to re-authenticate the self-service removal with (ADR-068).
 *
 * The same guards as the MFA and password resets (loadAdminResetTarget): same
 * tenant or 404, never oneself (400), never a user whose role outranks the
 * caller's (403). Then, in ONE transaction:
 *  - every passkey column is cleared (the credential id, the public key and
 *    the sign count go with the flag);
 *  - EVERY session of the user is revoked: a session opened with the lost
 *    authenticator may be the thief's;
 *  - audited (UPDATE on User, `changes.operation` WEBAUTHN_ADMIN_RESET,
 *    actor = the administrator) — never the credential id or the key.
 *
 * The password and MFA are left as they are: the user signs in with them and
 * may register a new passkey.
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
 *   caller's tenant; 400 self; 403 higher role; 409 no passkey
 */
const resetUserPasskey = async (input: ActorContext & { userId: string; resetBy: string }): Promise<UserServiceResponse> => {
  const { userId, resetBy, actorIsSuperAdmin, actorTenantId, actorRoleLevel } = input;
  // Lazily: session.service loads the Session model and Redis.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const { revokeOtherSessions } = require("./session.service") as typeof SessionServiceModule;

  let transaction;
  try {
    transaction = await db.transaction();

    const user = await loadAdminResetTarget(transaction, {
      operation: "resetUserPasskey",
      userId,
      resetBy,
      actorIsSuperAdmin,
      actorTenantId,
      actorRoleLevel,
      selfMessage:
        "You cannot remove your own passkey here; remove it on the Passkeys page with your password",
      what: "passkey",
    });

    if (!user.webauthnEnabled) {
      throw { status: 409, message: "This user has no passkey to remove" };
    }

    await user.update(
      {
        webauthnEnabled: false,
        webauthnCredentialId: null,
        webauthnPublicKey: null,
        webauthnSignCount: 0,
      },
      { transaction },
    );
    const sessionsRevoked = await revokeOtherSessions(user.id, null, "WEBAUTHN_ADMIN_RESET", {
      transaction,
    });

    await auditUserChange(transaction, input, {
      action: "UPDATE",
      actorUserId: resetBy,
      user,
      changes: { operation: "WEBAUTHN_ADMIN_RESET", sessionsRevoked },
    });

    await transaction.commit();

    logger.info("User passkey removed by an administrator", { userId: user.id, resetBy });

    return {
      success: true,
      status: 200,
      message:
        "The passkey has been removed and the user's sessions were signed out. They sign in with their password and may register a new passkey.",
      data: { id: user.id, webauthnEnabled: false, sessionsRevoked },
    };
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction && !finishedOf(transaction)) {
      await transaction.rollback();
    }
    logger.error("Error removing user passkey", { err: err.message, userId, resetBy });
    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

// ------------------------------------------------------------------
// ADMIN-ASSISTED PASSWORD RESET (A-162)
// ------------------------------------------------------------------

// No 0/O, 1/l/I: the password is read off a screen and typed or dictated.
const TEMPORARY_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
// 16 characters of a 57-symbol alphabet: ~93 bits.
const TEMPORARY_PASSWORD_LENGTH = 16;

/**
 * A random temporary password from a CSPRNG (crypto.randomInt is unbiased).
 *
 * @returns {string}
 */
const generateTemporaryPassword = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const crypto = require("crypto") as typeof CryptoModule;
  let out = "";
  for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i += 1) {
    // randomInt(length) is always a valid index.
    out += TEMPORARY_PASSWORD_ALPHABET[crypto.randomInt(TEMPORARY_PASSWORD_ALPHABET.length)] as string;
  }
  return out;
};

/**
 * A-215 (ADR-068) — how long an administrator-chosen password (a create or a
 * reset) signs in before it must be replaced: 72 hours, which spans a
 * weekend. After it, sign-in answers the same 401 as a wrong password
 * (auth.service#loginUser) and the administrator issues a new one.
 */
const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

/** @returns {Date} when a temporary password issued now expires */
const temporaryPasswordExpiry = (): Date => new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS);

// A-37 (ADR-075): SCIM provisioning asks the same global question — "does any
// account, in any tenant, deleted or not, hold this identity?" — so it asks it
// here, where the answer is defined once (A-128). It is exported below.

/**
 * A tenant administrator replaces another user's password with a random
 * temporary one — for a user who cannot use the e-mail-code reset (no access
 * to the mailbox, or no working mail in the deployment).
 *
 * The same guards as the MFA reset (loadAdminResetTarget): same tenant or 404,
 * never oneself (400), never a user whose role outranks the caller's (403).
 * Then, in ONE transaction:
 *  - the password becomes the temporary one (only its hash is stored);
 *  - `mustChangePassword` is set (A-123): the holder must replace it before
 *    anything else, so the administrator's knowledge of it is short-lived;
 *  - a lockout from failed sign-ins is lifted, or the temporary password
 *    could not be used;
 *  - EVERY session of the user is revoked;
 *  - audited (UPDATE on User, `changes.operation` PASSWORD_ADMIN_RESET,
 *    actor = the administrator) — never the password or its hash.
 *
 * The temporary password is returned ONCE, in this response, and nowhere
 * else: not logged, not audited, not stored in clear.
 *
 * It does NOT touch MFA: a user with MFA still needs their second factor, so
 * the administrator who knows the temporary password cannot sign in as them
 * with it alone. Residual risk, stated plainly: for a user WITHOUT MFA the
 * administrator can sign in with the temporary password before the holder
 * does, and then choose the "changed" password themselves. The audit row and
 * the holder finding their password changed are the controls.
 *
 * @param {object} input
 * @param {string} input.userId - the target
 * @param {string} input.resetBy - the administrator (req.user.id)
 * @param {boolean} [input.actorIsSuperAdmin]
 * @param {string|null} [input.actorTenantId]
 * @param {number} [input.actorRoleLevel]
 * @param {string|null} [input.ipAddress]
 * @param {string|null} [input.userAgent]
 * @returns {Promise<object>} the envelope; data carries `temporaryPassword`
 * @throws {{status: number, message: string}} 404 not found / not in the
 *   caller's tenant; 400 self; 403 higher role
 */
const resetUserPassword = async (input: ActorContext & { userId: string; resetBy: string }): Promise<UserServiceResponse> => {
  const { userId, resetBy, actorIsSuperAdmin, actorTenantId, actorRoleLevel } = input;
  // Lazily: session.service loads the Session model and Redis.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const { revokeOtherSessions } = require("./session.service") as typeof SessionServiceModule;

  let transaction;
  try {
    transaction = await db.transaction();

    const user = await loadAdminResetTarget(transaction, {
      operation: "resetUserPassword",
      userId,
      resetBy,
      actorIsSuperAdmin,
      actorTenantId,
      actorRoleLevel,
      selfMessage:
        "You cannot reset your own password here; change it on the change-password page",
      what: "password",
    });

    const temporaryPassword = generateTemporaryPassword();
    const hashed = await hashPassword(temporaryPassword);
    // A-215: it expires (TEMPORARY_PASSWORD_TTL_MS).
    const temporaryPasswordExpiresAt = temporaryPasswordExpiry();

    await user.update(
      {
        password: hashed,
        mustChangePassword: true,
        temporaryPasswordExpiresAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      // P10-16 (ADR-099 Amendment 1): the temporary password signs in ONCE.
      { transaction, oneTimePassword: true },
    );
    const sessionsRevoked = await revokeOtherSessions(user.id, null, "PASSWORD_ADMIN_RESET", {
      transaction,
    });

    await auditUserChange(transaction, input, {
      action: "UPDATE",
      actorUserId: resetBy,
      user,
      // The key is not "mustChangePassword": it keeps the row free of the
      // word the A-77 redaction check looks for (as userCreate does).
      changes: {
        operation: "PASSWORD_ADMIN_RESET",
        sessionsRevoked,
        firstLoginChangeRequired: true,
        firstLoginChangeDeadline: temporaryPasswordExpiresAt.toISOString(),
      },
    });

    await transaction.commit();

    logger.info("User password reset by an administrator", { userId: user.id, resetBy });

    return {
      success: true,
      status: 200,
      message:
        "Password has been reset. Give the user this temporary password; it is shown only once, it stops working after 72 hours, and they must change it when they sign in.",
      data: {
        id: user.id,
        temporaryPassword,
        mustChangePassword: true,
        temporaryPasswordExpiresAt,
        sessionsRevoked,
      },
    };
  } catch (caught) {
    const err = caught as ErrorLike;
    if (transaction && !finishedOf(transaction)) {
      await transaction.rollback();
    }
    logger.error("Error resetting user password", { err: err.message, userId, resetBy });
    throw {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 / "" fall back */
      status: err.status || 500,
      message: err.message || "Internal server error",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    };
  }
};

export = {
  fetchUsers,
  fetchSpecificUser,
  checkUsernameAvailability,
  userRoleUpdate,
  userCreate,
  editUser,
  updateUserAvatar,
  removeUserAvatar,
  deleteUser,
  resetUserMfa,
  resetUserPasskey,
  generateTemporaryPassword,
  TEMPORARY_PASSWORD_LENGTH,
  TEMPORARY_PASSWORD_TTL_MS,
  temporaryPasswordExpiry,
  assertIdentityFree,
  resetUserPassword,
};
