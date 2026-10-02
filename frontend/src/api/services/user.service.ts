// src/api/services/user.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the request and answer
// types are the contract's (backend/src/routes/api/user.openapi.ts →
// @callibrator/contracts/user), which replaced the interim `z.input` types
// (ADR-097 Am. 1). The exported names are unchanged. The avatar upload stays
// on `api` (multipart).
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";
import { User, PaginatedResponse } from "@/types";

export type UserCreateInput = JsonBody<Op<"/api/v1/users/create", "post">>;
export type UserUpdateInput = JsonBody<Op<"/api/v1/users/edit", "patch">>;
/** PATCH /users/:userId/profile — `userId` goes in the path, the rest in the body. */
export type UserProfileInput = JsonBody<Op<"/api/v1/users/{userId}/profile", "patch">> & { userId: string };

/** A user as the API answers one (without credentials or second-factor secrets). */
export type ApiUser = components["schemas"]["User"];

/** A-162: POST /users/:userId/mfa/reset → data. */
export type MfaResetResult = DataOf<Op<"/api/v1/users/{userId}/mfa/reset", "post">>;

/** A-262: DELETE /users/:userId/webauthn → data. */
export type PasskeyResetResult = DataOf<Op<"/api/v1/users/{userId}/webauthn", "delete">>;

/** A-162: POST /users/:userId/password/reset → data. The password is shown once. */
export type PasswordResetResult = DataOf<Op<"/api/v1/users/{userId}/password/reset", "post">>;

type ListQuery = QueryOf<Op<"/api/v1/users/all", "get">>;

/** A string field of the open user row (the legacy aliases and getters). */
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

// Transform the API's user row to the app's User type
const transformUser = (item: ApiUser): User => ({
  id: item.id,
  username: item.username,
  firstName: item.firstName || text(item.first_name) || "",
  lastName: item.lastName || text(item.last_name) || "",
  // As built: the alias, else the name (a null name stays null at run time).
  first_name: (text(item.first_name) || item.firstName) as string | undefined,
  last_name: (text(item.last_name) || item.lastName) as string | undefined,
  email: item.email,
  tenantId: item.tenantId,
  // As built: `isBanned` is no column (the fallback is for a row with no status).
  status: (item.status as User["status"]) || (item.isBanned
    ? "SUSPENDED"
    : item.isEmailVerified
      ? "ACTIVE"
      : "PENDING"),
  // As built: the getter's URL, else the stored name (null without an avatar).
  picture: (text(item.picture) || text(item.pictureUrl) || item.avatarUrl) as string | undefined,
  role: item.role
    ? {
        id: item.role.id,
        name: item.role.name,
        description: item.role.description as string | null,
        nameToShow: item.role.nameToShow || item.role.name,
        isActive: (item.role.isActive as boolean | undefined) ?? (item.role.status !== "deleted"),
      }
    : undefined,
  createdAt: item.createdAt,
  updatedAt: item.createdAt,
  mfaEnabled: item.mfaEnabled === true,
  mustChangePassword: item.mustChangePassword === true,
  webauthnEnabled: item.webauthnEnabled === true,
});

/**
 * A single-user answer, as the app's User. As built: the row is handed on
 * unchanged (only the list is transformed); its nullable names are read by
 * the callers as strings.
 */
const asUser = (row: ApiUser): User => row as unknown as User;

const byUser = (userId: string) => ({ params: { path: { userId } } });

export const userService = {
  /**
   * A-141 / A-162: a tenant administrator clears another user's MFA. The
   * backend signs out every session of theirs; they sign in with the password
   * and enrol again. 404 for a user outside the caller's tenant, 400 for the
   * caller, 403 for a higher role, 409 when the user has no MFA.
   */
  resetMfa: async (userId: string): Promise<MfaResetResult> =>
    (await typedApi.POST("/api/v1/users/{userId}/mfa/reset", byUser(userId)).then(unwrap)).data,

  /**
   * A-262: a tenant administrator removes another user's passkey. The backend
   * signs out every session of theirs; the password and MFA stay. 404 for a
   * user outside the caller's tenant, 400 for the caller, 403 for a higher
   * role, 409 when the user has no passkey.
   */
  resetPasskey: async (userId: string): Promise<PasskeyResetResult> =>
    (await typedApi.DELETE("/api/v1/users/{userId}/webauthn", byUser(userId)).then(unwrap)).data,

  /**
   * A-162: a tenant administrator replaces another user's password with a
   * temporary one, returned ONCE — show it, never store it. The user must
   * change it at their next sign-in; every session of theirs is signed out.
   */
  resetPassword: async (userId: string): Promise<PasswordResetResult> =>
    (await typedApi.POST("/api/v1/users/{userId}/password/reset", byUser(userId)).then(unwrap)).data,

  getAll: async (
    page = 1,
    limit = 50,
    search?: string,
    tenantId?: string,
    roleFilter?: string,
  ): Promise<PaginatedResponse<User>> => {
    const query: ListQuery = { page, limit, find: search, tenantId, roleFilter };
    const response = await typedApi.GET("/api/v1/users/all", { params: { query } }).then(unwrap);

    // Transform backend users to our User type
    const users = response.data.map(transformUser);

    return {
      success: response.success,
      message: response.message,
      data: users,
      meta: response.meta,
    };
  },

  getById: async (userId: string): Promise<User> =>
    asUser((await typedApi.POST("/api/v1/users/detail", { body: { userId } }).then(unwrap)).data),

  create: async (data: UserCreateInput): Promise<User> =>
    asUser((await typedApi.POST("/api/v1/users/create", { body: data }).then(unwrap)).data),

  update: async (data: UserUpdateInput): Promise<User> =>
    asUser((await typedApi.PATCH("/api/v1/users/edit", { body: data }).then(unwrap)).data),

  // A-63: the caller's own profile goes to PATCH /users/:userId/profile — the
  // backend's self bypass trusts only the path, never a body `userId`, so
  // PATCH /users/edit now requires `users` update access.
  updateProfile: async ({
    userId,
    ...fields
  }: UserProfileInput): Promise<User> =>
    asUser(
      (await typedApi.PATCH("/api/v1/users/{userId}/profile", { ...byUser(userId), body: fields }).then(unwrap))
        .data,
    ),

  changePassword: async (data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string }> => {
    const response = await typedApi
      .POST("/api/v1/auth/just-update-password", {
        body: {
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
        },
      })
      .then(unwrap);
    return {
      success: response.success,
      message: response.message || "Password changed successfully",
    };
  },

  updateRole: async (userId: string, roleId: string): Promise<void> => {
    await typedApi.POST("/api/v1/users/role-update", { body: { userId, roleId } });
  },

  delete: async (userId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/users/delete", { params: { query: { userId } } });
  },

  checkUsername: async (username: string): Promise<{ available: boolean }> => {
    const response = await typedApi
      .POST("/api/v1/users/username-check", { body: { username } })
      .then(unwrap);
    const available = response.data?.available ?? false;
    return { available };
  },

  uploadAvatar: async (userId: string, file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("file", file);
    await api.post(`/api/v1/users/${userId}/avatar`, formData);
  },

  deleteAvatar: async (userId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/users/{userId}/avatar", byUser(userId));
  },

  verifyCurrentPassword: async (
    password: string,
  ): Promise<{ valid: boolean }> => {
    try {
      // The endpoint answers 200 with `{ data: { valid } }` whether or not the
      // password matched — `success` is always true, so the result MUST be read
      // from `data.valid` (reading `success` reported every password as valid).
      const response = await typedApi
        .POST("/api/v1/auth/pass-is-valid", { body: { password } })
        .then(unwrap);
      return { valid: response.data?.valid === true };
    } catch {
      throw new Error("Invalid password");
    }
  },
};
