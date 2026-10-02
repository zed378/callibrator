/**
 * User validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod. `status` is matched case-insensitively and
 * output upper-case, and `email` / `username` are lower-cased, which is what
 * the previous schemas' object-level custom step did after validation.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/user.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for /api/v1/users (list query, id params, create, update, profile and password bodies).
 */
import { z } from "zod";
import { caseless, email as emailAddress, nullableText, numeric, uuid } from "./fields";

const USER_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const;

/** Letters and digits, 3-30, stored lower-case. */
const username = z
  .string()
  .regex(/^[a-zA-Z0-9]+$/, { error: "Username must only contain letters and digits" })
  .min(3)
  .max(30)
  .transform((name) => name.toLowerCase());

const personName = z.string().trim().min(2).max(100);

const email = emailAddress().transform((address) => address.toLowerCase());

// ==========================================
// GET ALL USERS QUERY
// ==========================================

const getAllUsersQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(100)).default(50),
  find: nullableText(),
  status: caseless(USER_STATUSES, "upper").or(z.literal("")).nullable().optional(),
  roleFilter: nullableText(),
  tenantId: uuid().or(z.literal("")).nullable().optional(),
});

// ==========================================
// CREATE USER
// ==========================================

const createUserSchema = z.object({
  username,
  firstName: personName,
  lastName: personName,
  email,
  password: z.string().min(8),
  roleId: uuid(),
  tenantId: uuid().or(z.literal("")).nullable().optional(),
  status: caseless(USER_STATUSES, "upper").nullable().default("ACTIVE"),
});

// ==========================================
// UPDATE USER
// ==========================================

const updateUserSchema = z.object({
  // userId identifies the target user and must survive validation (it was
  // once stripped, which made editUser look up `undefined` -> 404).
  userId: uuid(),
  username: username.optional(),
  firstName: personName.optional(),
  lastName: personName.optional(),
  email: email.optional(),
  status: caseless(USER_STATUSES, "upper").optional(),
});

// ==========================================
// UPDATE OWN PROFILE (A-63)
// ==========================================

/**
 * PATCH /users/:userId/profile. The target is the PATH `userId` (merged in by
 * the controller), never a body field. Only the profile fields: `status` and
 * `email` stay on the permission-gated PATCH /users/edit, so the self bypass
 * cannot be used to reactivate, deactivate or re-address an account.
 */
const updateProfileSchema = z.object({
  userId: uuid(),
  username: username.optional(),
  firstName: personName.optional(),
  lastName: personName.optional(),
});

// ==========================================
// GET/DELETE USER BY ID
// ==========================================

const userParamSchema = z.object({
  userId: uuid(),
});

// ==========================================
// ROLE UPDATE
// ==========================================

const updateRoleSchema = z.object({
  userId: uuid(),
  roleId: uuid(),
});

// ==========================================
// USERNAME CHECK
// ==========================================

const usernameCheckSchema = z.object({
  username: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, { error: "Username must only contain letters and digits" })
    .min(3)
    .max(30),
});

export {
  getAllUsersQuery,
  createUserSchema,
  updateUserSchema,
  updateProfileSchema,
  userParamSchema,
  updateRoleSchema,
  usernameCheckSchema,
};

// The client-side (input) and handler-side (output) types of each schema.
export type GetAllUsersQueryInput = z.input<typeof getAllUsersQuery>;
export type GetAllUsersQueryBody = z.output<typeof getAllUsersQuery>;
export type CreateUserInput = z.input<typeof createUserSchema>;
export type CreateUserBody = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;
export type UpdateUserBody = z.output<typeof updateUserSchema>;
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
export type UpdateProfileBody = z.output<typeof updateProfileSchema>;
export type UserParamInput = z.input<typeof userParamSchema>;
export type UserParamBody = z.output<typeof userParamSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;
export type UpdateRoleBody = z.output<typeof updateRoleSchema>;
export type UsernameCheckInput = z.input<typeof usernameCheckSchema>;
export type UsernameCheckBody = z.output<typeof usernameCheckSchema>;
