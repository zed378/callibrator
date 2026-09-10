import { api } from "../client";

// Backend routes (SUPERADMIN only):
//   GET    /api/v1/user-permissions/:userId
//   POST   /api/v1/user-permissions/:userId              { menuGroupId, permissionType, notes? }
//   DELETE /api/v1/user-permissions/:userId/:menuGroupId
//
// Semantics: a user inherits permissions from their role; a custom override
// ("read"/"write") replaces the role permission for that menu, and "none"
// explicitly denies it. Removing the override restores role inheritance.

export type UserPermissionType = "read" | "write" | "none";

export interface PermissionMenu {
  id: string;
  name: string;
  slug?: string;
  icon?: string | null;
  parentId?: string | null;
}

export interface EffectivePermission {
  menuGroupId: string;
  menu: PermissionMenu | null;
  /** Resolved access: "read" | "write" | null (no access) */
  permissionType: "read" | "write" | null;
  /** Where the resolved access comes from */
  source: "role" | "custom" | null;
  /** The raw role permission for this menu (before overrides) */
  rolePermission: "read" | "write" | null;
  /** The raw override, if any ("none" = explicit deny) */
  override: UserPermissionType | null;
}

export interface UserPermissionsData {
  user: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    email: string;
    tenantId?: string | null;
    role: {
      id: string;
      name: string;
      nameToShow?: string;
    } | null;
  };
  rolePermissions: Array<{
    menuGroupId: string;
    menu: PermissionMenu | null;
    permissionType: "read" | "write";
  }>;
  overrides: Array<{
    menuGroupId: string;
    menu: PermissionMenu | null;
    permissionType: UserPermissionType;
    notes?: string | null;
  }>;
  effective: EffectivePermission[];
}

interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

export const userPermissionService = {
  /** Full permission picture for one user (role + custom + effective). */
  getUserPermissions: async (userId: string): Promise<UserPermissionsData> => {
    const response = await api.get<BackendResponse<UserPermissionsData>>(
      `/api/v1/user-permissions/${userId}`,
    );
    return response.data;
  },

  /** Upsert a custom override ("read" | "write" | "none"). */
  setUserPermission: async (
    userId: string,
    menuGroupId: string,
    permissionType: UserPermissionType,
    notes?: string,
  ): Promise<void> => {
    await api.post(`/api/v1/user-permissions/${userId}`, {
      menuGroupId,
      permissionType,
      notes,
    });
  },

  /** Remove an override — user falls back to role inheritance. */
  removeUserPermission: async (
    userId: string,
    menuGroupId: string,
  ): Promise<void> => {
    await api.delete(`/api/v1/user-permissions/${userId}/${menuGroupId}`);
  },
};
