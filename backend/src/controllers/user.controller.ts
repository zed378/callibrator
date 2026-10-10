// P9-20 (ADR-087; converted under the four isolation gates): from
// user.controller.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order). The service
// is the module object; every other load-time destructure is kept as a capture
// at load. The lazy requires (upload.util and the logger on a failure path, the
// models barrel in getAllUsersSimple) stay lazy. Request data is read through
// typed views of the request; the emitted expressions (`req.user.role`,
// `req.user.id` unguarded where the `.js` read them so) are the `.js` ones.
import type { Request, Response } from "express";

import userService from "../services/user.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
// A-282 (ADR-100): the audit actor. For an API key, req.user.id is the KEY's id,
// which audit_logs.user_id (a foreign key to users) cannot hold: the key is
// recorded as system:api-key, with its id in changes.apiKeyId.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
import {
  createUserSchema as loadedCreateUserSchema,
  updateUserSchema as loadedUpdateUserSchema,
  updateProfileSchema as loadedUpdateProfileSchema,
  // The validator exports this as `updateRoleSchema` ({ userId, roleId }).
  updateRoleSchema as loadedUpdateUserRoleSchema,
  usernameCheckSchema as loadedCheckUsernameSchema,
  userParamSchema as loadedUserParamSchema,
  getAllUsersQuery as loadedGetAllUsersQuery,
} from "../validators/user.validator";
import { checkInput as loadedCheckInput } from "../validators/input";
import type { CheckResult } from "../validators/input";
import type * as UploadUtil from "../utils/upload.util";
import type * as ActivityLog from "../middlewares/activityLog.middleware";
import type { ModelsBarrel } from "../types/models";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;
const isSuperAdmin = loadedIsSuperAdmin;
const createUserSchema = loadedCreateUserSchema;
const updateUserSchema = loadedUpdateUserSchema;
const updateProfileSchema = loadedUpdateProfileSchema;
const updateUserRoleSchema = loadedUpdateUserRoleSchema;
const checkUsernameSchema = loadedCheckUsernameSchema;
const userParamSchema = loadedUserParamSchema;
const getAllUsersQuery = loadedGetAllUsersQuery;
const checkInput = loadedCheckInput;

/** The request as `auth` (and, for an avatar, the upload middleware) leaves it. */
type UserRequest = Request & {
  user: {
    id: string;
    tenantId?: string | null;
    role: { name?: string | null; roleLevel: number };
    isApiKey?: boolean;
  };
  file?: unknown;
  uploadFilename?: string;
};

/** The path parameter these routes name (`validateUuid("userId")`). */
interface UserParams extends Record<string, string> {
  userId: string;
}

/** A validation failure, as the `.js` built it. */
type ValidationError = Error & { status: number; errors: unknown };

/**
 * Handle validation error and send error response
 */
// As built: `res` (here `_res`) is in the signature and never read.
const handleValidation = <T>(result: CheckResult<T>, _res: Response, status = 400): T => {
  if (!result.ok) {
    const err = new Error("Validation failed") as ValidationError;
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
const getActor = (req: UserRequest): {
  actorTenantId: string | null;
  actorIsSuperAdmin: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  apiKeyId: string | null;
} => {
  // A-77: the IP and user agent go into the audit row the service writes
  // inside its transaction. A-282: so does the API key that acted, if one did.
  const { ipAddress, userAgent, apiKeyId } = auditPrincipal(req);
  return {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: `req.user?.tenantId || null`
    actorTenantId: req.user?.tenantId || null,
    actorIsSuperAdmin: isSuperAdmin(req.user),
    ipAddress,
    userAgent,
    apiKeyId,
  };
};

/** A-282: the acting USER's id — null for an API key, whose id is no user. */
const actingUserId = (req: UserRequest): string | null => auditPrincipal(req).userId;

/** The body, as a JavaScript caller sends it (a plain object, or none). */
const bodyOf = (req: Request): Record<string, unknown> | undefined => req.body as Record<string, unknown> | undefined;

/** A service result, as these handlers read it. */
interface ResultView {
  data: unknown;
  meta?: object | null | undefined;
  message?: string | undefined;
  status?: number | undefined;
}

const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const checked = checkInput(r.query, getAllUsersQuery);
  if (!checked.ok) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Validation failed",
      data: null,
      errors: checked.errors,
    });
  }
  const { value } = checked;

  const role = r.user.role;
  const { actorIsSuperAdmin, actorTenantId } = getActor(r);

  // Non-super-admins are locked to their own tenant regardless of any
  // client-supplied tenantId (prevents cross-tenant enumeration / BOLA).
  const effectiveTenantId = actorIsSuperAdmin ? value.tenantId : actorTenantId;

  const result = (await userService.fetchUsers({
    tenantId: effectiveTenantId,
    roleFilter: value.roleFilter,
    role,
    find: value.find,
    page: value.page,
    limit: value.limit,
  })) as ResultView;

  success(
    res,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `result.data.rows || result.data`
    (result.data as { rows?: unknown }).rows || result.data,
    // As built: the meta as the service gave it (an undefined one takes success()'s default, null).
    result.meta,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "Fetch users successful",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
    result.status || 200,
  );
  return undefined;
});

const getSpecificUser = asyncHandler(async (req: Request, res: Response) => {
  const merged: { userId?: string } = { ...bodyOf(req), ...req.params };
  const userId = merged.userId as string;

  const result = (await userService.fetchSpecificUser(userId)) as ResultView;
  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "Fetch user successful",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
    result.status || 200,
  );
});

const checkUsernameAvailability = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const validated = handleValidation(
    checkInput(r.body, checkUsernameSchema),
    res,
  );
  // A-258: the probe answers what userCreate would, so it carries the same
  // actor — its "taken" answers are counted and audited as A-128 conflicts.
  const result = (await userService.checkUsernameAvailability({
    ...validated,
    actorId: actingUserId(r),
    ...getActor(r),
  })) as ResultView;

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "Username availability checked",
    200,
  );
});

const updateUserRole = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const validated = handleValidation(
    checkInput(r.body, updateUserRoleSchema),
    res,
  );
  const result = (await userService.userRoleUpdate({
    ...validated,
    updatedBy: actingUserId(r),
    ...getActor(r),
  })) as ResultView;

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
  success(res, result.data, null, result.message || "User role updated", 200);
});

const createUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const validated = handleValidation(
    checkInput(r.body, createUserSchema),
    res,
  );
  const result = (await userService.userCreate({
    ...validated,
    createdBy: actingUserId(r),
    ...getActor(r),
  })) as ResultView;

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "User created successfully",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
    result.status || 201,
  );
});

const editUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const validated = handleValidation(
    checkInput(r.body, updateUserSchema),
    res,
  );
  const result = (await userService.editUser({
    ...validated,
    updatedBy: actingUserId(r),
    ...getActor(r),
  })) as ResultView;

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "User updated successfully",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
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
const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const validated = handleValidation(
    checkInput({ ...bodyOf(req), userId: (r.params as UserParams).userId }, updateProfileSchema),
    res,
  );
  const result = (await userService.editUser({
    ...validated,
    updatedBy: actingUserId(r),
    ...getActor(r),
  })) as ResultView;

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "Profile updated successfully",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
    result.status || 200,
  );
});

const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const checked = checkInput(r.query, userParamSchema);
  if (!checked.ok) {
    return res.status(400).json({
      success: false,
      status: 400,
      message:
        "Validation failed - userId is required and must be a valid UUID",
      data: null,
      errors: checked.errors,
    });
  }
  const { value } = checked;

  const { userId } = value;
  const deletedBy = actingUserId(r);

  const result = (await userService.deleteUser({
    userId,
    deletedBy,
    ...getActor(r),
  })) as ResultView;

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "User deleted successfully",
    200,
  );
  return undefined;
});

/**
 * A-96. Remove the avatar file THIS request uploaded, after the service
 * refused or failed. Never throws: the original error is what the caller must
 * see.
 *
 * @param {import("express").Request} req
 */
const discardUploadedAvatar = async (req: UserRequest): Promise<void> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only on this failure path
    await (require("../utils/upload.util") as typeof UploadUtil).deleteUpload(req.uploadFilename as string, "uploads/public/profile");
  } catch (deleteErr) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only on this failure path
    (require("../middlewares/activityLog.middleware") as typeof ActivityLog).logger.warn(
      `Failed to delete uploaded avatar after failure: ${String(req.uploadFilename)}`,
      deleteErr,
    );
  }
};

const uploadUserAvatar = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  // The PATH names the user (the gate checked it); a body userId never wins.
  const merged: { userId?: string } = { ...bodyOf(req), ...req.params };
  const userId = merged.userId as string;
  const updatedBy = actingUserId(r);

  if (!r.file) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "No file uploaded",
      data: null,
    });
  }

  let result: ResultView;
  try {
    // A-96: the service audits inside its transaction and throws for every
    // refusal BEFORE the commit — so a throw means the upload belongs to
    // nobody and must not stay on disk.
    result = await userService.updateUserAvatar(
      userId,
      r.uploadFilename as string,
      updatedBy,
      getActor(r),
    );
  } catch (err) {
    await discardUploadedAvatar(r);
    throw err;
  }

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "User avatar uploaded successfully",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
    result.status || 200,
  );
  return undefined;
});

const removeUserAvatar = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const merged: { userId?: string } = { ...bodyOf(req), ...req.params };
  const userId = merged.userId as string;
  const updatedBy = actingUserId(r);

  const result = (await userService.removeUserAvatar(userId, updatedBy, getActor(r))) as ResultView;

  success(
    res,
    result.data,
    null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back
    result.message || "User avatar removed successfully",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls back
    result.status || 200,
  );
});

const getAllUsersSimple = asyncHandler(async (_req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the barrel is loaded when the handler runs
  const { Users, Roles } = require("../models") as ModelsBarrel;

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
const resetUserMfa = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const result = (await userService.resetUserMfa({
    userId: (r.params as UserParams).userId,
    resetBy: r.user.id,
    // rbac() ran first and refused a principal without a role.
    actorRoleLevel: r.user.role.roleLevel,
    ...getActor(r),
  })) as ResultView;

  success(res, result.data, null, result.message, result.status);
});

/**
 * A-262. DELETE /users/:userId/webauthn — a tenant administrator removes
 * another user's passkey. The target comes from the PATH; tenant, privilege
 * and role level come from the authenticated principal, never the body.
 */
const resetUserPasskey = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const result = (await userService.resetUserPasskey({
    userId: (r.params as UserParams).userId,
    resetBy: r.user.id,
    // rbac() ran first and refused a principal without a role.
    actorRoleLevel: r.user.role.roleLevel,
    ...getActor(r),
  })) as ResultView;

  success(res, result.data, null, result.message, result.status);
});

/**
 * A-162. POST /users/:userId/password/reset — a tenant administrator replaces
 * another user's password with a temporary one, shown once. The target comes
 * from the PATH; tenant, privilege and role level from the authenticated
 * principal, never the body. The response carries a credential: it must not
 * be cached anywhere on the way back.
 */
const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const r = req as UserRequest;
  const result = (await userService.resetUserPassword({
    userId: (r.params as UserParams).userId,
    resetBy: r.user.id,
    // rbac() ran first and refused a principal without a role.
    actorRoleLevel: r.user.role.roleLevel,
    ...getActor(r),
  })) as ResultView;

  res.setHeader("Cache-Control", "no-store");
  success(res, result.data, null, result.message, result.status);
});

const controller = {
  getAllUsers,
  getSpecificUser,
  checkUsernameAvailability,
  updateUserRole,
  createUser,
  editUser,
  updateProfile,
  deleteUser,
  uploadUserAvatar,
  removeUserAvatar,
  getAllUsersSimple,
  resetUserMfa,
  resetUserPasskey,
  resetUserPassword,
};

export = controller;
