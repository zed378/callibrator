import { api } from "../client";
import { User, PaginatedResponse } from "@/types";

// Backend response structure for users list (actual API response)
interface BackendUserItem {
  id: string;
  tenantId: string | null;
  username: string;
  firstName: string;
  lastName: string;
  first_name?: string;
  last_name?: string;
  email: string;
  picture: string;
  roleId?: string;
  tenantRoleId?: string | null;
  isEmailVerified: boolean;
  isBanned?: boolean;
  status?: string;
  lastLoginAt: string;
  createdAt: string;
  role?: {
    id: string;
    name: string;
    description: string;
    nameToShow: string;
    isActive?: boolean;
    status?: string;
  };
  pictureUrl?: string;
  avatarUrl?: string;
  // A-162: the list carries these (safeUserAttributes excludes only secrets),
  // so the users page can offer "Reset MFA" only where there is MFA.
  mfaEnabled?: boolean;
  mustChangePassword?: boolean;
}

/** A-162: POST /users/:userId/mfa/reset → data. */
export interface MfaResetResult {
  id: string;
  mfaEnabled: false;
  sessionsRevoked: number;
}

/** A-162: POST /users/:userId/password/reset → data. The password is shown once. */
export interface PasswordResetResult {
  id: string;
  temporaryPassword: string;
  mustChangePassword: true;
  sessionsRevoked: number;
}

// Actual backend response: { success, status, message, data: User[], meta: {...} }
interface BackendUsersListResponse {
  success: boolean;
  status: number;
  message: string;
  data: BackendUserItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Transform backend user item to our User type
const transformUser = (item: BackendUserItem): User => ({
  id: item.id,
  username: item.username,
  firstName: item.firstName || item.first_name || "",
  lastName: item.lastName || item.last_name || "",
  first_name: item.first_name || item.firstName,
  last_name: item.last_name || item.lastName,
  email: item.email,
  tenantId: item.tenantId,
  status: (item.status as User["status"]) || (item.isBanned
    ? "SUSPENDED"
    : item.isEmailVerified
      ? "ACTIVE"
      : "PENDING"),
  picture: item.picture || item.pictureUrl || item.avatarUrl,
  role: item.role
    ? {
        id: item.role.id,
        name: item.role.name,
        description: item.role.description,
        nameToShow: item.role.nameToShow || item.role.name,
        isActive: item.role.isActive ?? (item.role.status !== "deleted"),
      }
    : undefined,
  createdAt: item.createdAt,
  updatedAt: item.createdAt,
  mfaEnabled: item.mfaEnabled === true,
  mustChangePassword: item.mustChangePassword === true,
});

export const userService = {
  /**
   * A-141 / A-162: a tenant administrator clears another user's MFA. The
   * backend signs out every session of theirs; they sign in with the password
   * and enrol again. 404 for a user outside the caller's tenant, 400 for the
   * caller, 403 for a higher role, 409 when the user has no MFA.
   */
  resetMfa: async (userId: string): Promise<MfaResetResult> => {
    const response = await api.post<{ success: boolean; data: MfaResetResult }>(
      `/api/v1/users/${encodeURIComponent(userId)}/mfa/reset`,
    );
    return response.data;
  },

  /**
   * A-162: a tenant administrator replaces another user's password with a
   * temporary one, returned ONCE — show it, never store it. The user must
   * change it at their next sign-in; every session of theirs is signed out.
   */
  resetPassword: async (userId: string): Promise<PasswordResetResult> => {
    const response = await api.post<{ success: boolean; data: PasswordResetResult }>(
      `/api/v1/users/${encodeURIComponent(userId)}/password/reset`,
    );
    return response.data;
  },

  getAll: async (
    page = 1,
    limit = 50,
    search?: string,
    tenantId?: string,
    roleFilter?: string,
  ): Promise<PaginatedResponse<User>> => {
    const response = await api.get<BackendUsersListResponse>(
      "/api/v1/users/all",
      {
        params: { page, limit, find: search, tenantId, roleFilter },
      },
    );

    // Transform backend users to our User type
    const users = response.data.map(transformUser);

    return {
      success: response.success,
      message: response.message,
      data: users,
      meta: response.meta,
    };
  },

  getById: async (userId: string): Promise<User> => {
    const response = await api.post<{ success: boolean; data: User }>(
      "/api/v1/users/detail",
      { userId },
    );
    return response.data;
  },

  create: async (data: {
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    roleId: string;
    tenantId?: string;
  }): Promise<User> => {
    const response = await api.post<{ success: boolean; data: User }>(
      "/api/v1/users/create",
      data,
    );
    return response.data;
  },

  update: async (data: {
    userId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    status?: string;
  }): Promise<User> => {
    const response = await api.patch<{ success: boolean; data: User }>(
      "/api/v1/users/edit",
      data,
    );
    return response.data;
  },

  // A-63: the caller's own profile goes to PATCH /users/:userId/profile — the
  // backend's self bypass trusts only the path, never a body `userId`, so
  // PATCH /users/edit now requires `users` update access.
  updateProfile: async ({
    userId,
    ...fields
  }: {
    userId: string;
    firstName?: string;
    lastName?: string;
    username?: string;
  }): Promise<User> => {
    const response = await api.patch<{ success: boolean; data: User }>(
      `/api/v1/users/${encodeURIComponent(userId)}/profile`,
      fields,
    );
    return response.data;
  },

  changePassword: async (data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{
      success: boolean;
      status: number;
      message: string;
      data: unknown;
    }>("/api/v1/auth/just-update-password", {
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    });
    return {
      success: response.success,
      message: response.message || "Password changed successfully",
    };
  },

  updateRole: async (userId: string, roleId: string): Promise<void> => {
    await api.post("/api/v1/users/role-update", { userId, roleId });
  },

  delete: async (userId: string): Promise<void> => {
    await api.delete(`/api/v1/users/delete`, { params: { userId } });
  },

  checkUsername: async (username: string): Promise<{ available: boolean }> => {
    const response = await api.post<{
      success: boolean;
      status: number;
      message: string;
      data: { username: string; available: boolean };
    }>("/api/v1/users/username-check", { username });
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
    await api.delete(`/api/v1/users/${userId}/avatar`);
  },

  verifyCurrentPassword: async (
    password: string,
  ): Promise<{ valid: boolean }> => {
    try {
      // The endpoint answers 200 with `{ data: { valid } }` whether or not the
      // password matched — `success` is always true, so the result MUST be read
      // from `data.valid` (reading `success` reported every password as valid).
      const response = await api.post<{
        success: boolean;
        status: number;
        message: string;
        data: { valid: boolean };
      }>("/api/v1/auth/pass-is-valid", {
        password,
      });
      return { valid: response.data?.valid === true };
    } catch {
      throw new Error("Invalid password");
    }
  },
};
