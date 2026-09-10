import { api } from "../client";
import { Role, PaginatedResponse } from "@/types";

// Menu group entity as returned by the roles menus endpoints
export interface RoleMenu {
  id: string;
  name: string;
  slug?: string;
  icon?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoleMenuCreateInput {
  name: string;
  slug?: string;
  icon?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface RoleMenuPermission {
  id?: string;
  roleId: string;
  menuGroupId: string;
  permissionType?: "read" | "write";
}

// Backend REST contract (roles.js):
//   GET    /api/v1/roles            -> { success, data: Role[], pagination: { page, limit, total } }
//   GET    /api/v1/roles/:id        -> { success, data: Role }
//   POST   /api/v1/roles            -> { success, data: Role }   (body: { name, description })
//   PATCH  /api/v1/roles/:id        -> { success, data: Role }   (body: { name?, description?, status? })
//   DELETE /api/v1/roles/:id        -> { success, ... }
// NOTE: paths are NOT trailing-slashed — `/api/v1/roles/` 308-redirects on the Next proxy.
interface BackendRolesListResponse {
  success: boolean;
  message?: string;
  data: Role[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

interface BackendRoleResponse {
  success: boolean;
  message?: string;
  data: Role;
}

export const roleService = {
  getAll: async (
    page = 1,
    limit = 50,
    search?: string,
  ): Promise<PaginatedResponse<Role>> => {
    const response = await api.get<BackendRolesListResponse>("/api/v1/roles", {
      params: { page, limit, search },
    });

    const total = response.pagination?.total ?? response.data.length;
    const lim = response.pagination?.limit ?? limit;
    const pg = response.pagination?.page ?? page;

    return {
      success: response.success,
      message: response.message ?? "",
      data: response.data,
      meta: {
        total,
        page: pg,
        limit: lim,
        totalPages: Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getById: async (roleId: string): Promise<Role> => {
    const response = await api.get<BackendRoleResponse>(
      `/api/v1/roles/${roleId}`,
    );
    return response.data;
  },

  create: async (data: {
    name: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
  }): Promise<Role> => {
    // Backend createRole only reads { name, description }.
    const response = await api.post<BackendRoleResponse>("/api/v1/roles", {
      name: data.name,
      description: data.description,
    });
    return response.data;
  },

  update: async (data: {
    id: string;
    name?: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
    status?: string;
  }): Promise<Role> => {
    // Backend updateRole reads { name, description, status }.
    const body: Record<string, unknown> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.description !== undefined) body.description = data.description;
    if (data.status !== undefined) {
      body.status = data.status;
    } else if (data.isActive !== undefined) {
      body.status = data.isActive ? "active" : "inactive";
    }

    const response = await api.patch<BackendRoleResponse>(
      `/api/v1/roles/${data.id}`,
      body,
    );
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/roles/${id}`);
  },

  // ------------------------------------------------------------------
  // MENU GROUPS (backend: /api/v1/roles/menus*)
  // ------------------------------------------------------------------

  getAllMenus: async (
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<PaginatedResponse<RoleMenu>> => {
    const response = await api.get<{
      success: boolean;
      message?: string;
      data: RoleMenu[];
      pagination: { page: number; limit: number; total: number };
    }>("/api/v1/roles/menus", { params: { page, limit, search } });

    const total = response.pagination?.total ?? response.data.length;
    const lim = response.pagination?.limit ?? limit;
    const pg = response.pagination?.page ?? page;

    return {
      success: response.success,
      message: response.message ?? "",
      data: response.data,
      meta: {
        total,
        page: pg,
        limit: lim,
        totalPages: Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getMenuById: async (menuId: string): Promise<RoleMenu> => {
    const response = await api.get<{ success: boolean; data: RoleMenu }>(
      `/api/v1/roles/menus/${menuId}`,
    );
    return response.data;
  },

  createMenu: async (data: RoleMenuCreateInput): Promise<RoleMenu> => {
    const response = await api.post<{ success: boolean; data: RoleMenu }>(
      "/api/v1/roles/menus",
      data,
    );
    return response.data;
  },

  updateMenu: async (
    menuId: string,
    data: Partial<RoleMenuCreateInput>,
  ): Promise<RoleMenu> => {
    const response = await api.patch<{ success: boolean; data: RoleMenu }>(
      `/api/v1/roles/menus/${menuId}`,
      data,
    );
    return response.data;
  },

  deleteMenu: async (menuId: string): Promise<void> => {
    await api.delete(`/api/v1/roles/menus/${menuId}`);
  },

  // ------------------------------------------------------------------
  // ROLE ↔ MENU PERMISSIONS (backend: /api/v1/roles/:roleId/permissions)
  // ------------------------------------------------------------------

  assignPermission: async (
    roleId: string,
    menuGroupId: string,
    permissionType: "read" | "write" = "read",
  ): Promise<RoleMenuPermission> => {
    const response = await api.post<{
      success: boolean;
      message?: string;
      data: RoleMenuPermission;
    }>(`/api/v1/roles/${roleId}/permissions`, { menuGroupId, permissionType });
    return response.data;
  },

  removePermission: async (
    roleId: string,
    menuGroupId: string,
  ): Promise<void> => {
    await api.delete(`/api/v1/roles/${roleId}/permissions/${menuGroupId}`);
  },

  // ------------------------------------------------------------------
  // ROLE ↔ USER ASSIGNMENT (backend: /api/v1/roles/assign)
  // ------------------------------------------------------------------

  assignRoleToUser: async (userId: string, roleId: string): Promise<void> => {
    await api.post("/api/v1/roles/assign", { userId, roleId });
  },

  removeRoleFromUser: async (userId: string): Promise<void> => {
    await api.delete(`/api/v1/roles/assign/${userId}`);
  },
};
