import { api } from "../client";
import { Role, PaginatedResponse } from "@/types";
import type {
  AssignPermissionInput,
  AssignRoleInput,
  CreateRoleInput,
  UpdateRoleInput,
} from "@callibrator/contracts/roles";

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

// P9-22 (ADR-097): the menu bodies have no declared contract (`createMenuSchema`
// is an open object, kept so by P9-11), so this one stays hand-written. The
// role, assignment and permission bodies below are the contract's own types.
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

// Backend REST contract (roles.controller.js, F-19 / ADR-105):
//   GET    /api/v1/roles            -> { success, data: Role[], meta: { total, page, limit, totalPages } }
//   GET    /api/v1/roles/:id        -> { success, data: Role }
//   POST   /api/v1/roles            -> { success, data: Role }   (body: { name, nameToShow?, description?, roleLevel? 1–8, status? })
//   PATCH  /api/v1/roles/:id        -> { success, data: Role }   (body: { name?, nameToShow?, description?, roleLevel? 1–8, status? })
// A role row carries `status` ("active" | "inactive"), never `isActive`; the
// service derives `isActive` from it (F-19: every role showed Inactive, and an
// edit re-activated an inactive one).
//   DELETE /api/v1/roles/:id        -> { success, ... }
// NOTE: paths are NOT trailing-slashed — `/api/v1/roles/` 308-redirects on the Next proxy.
interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

interface BackendRolesListResponse {
  success: boolean;
  message?: string;
  data: Role[];
  meta?: ListMeta;
}

/** The row as the backend sends it, with `isActive` read from `status`. */
const toRole = (row: Role): Role => ({
  ...row,
  isActive: row.status !== undefined ? row.status === "active" : row.isActive,
});

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

    const total = response.meta?.total ?? response.data.length;
    const lim = response.meta?.limit ?? limit;
    const pg = response.meta?.page ?? page;

    return {
      success: response.success,
      message: response.message ?? "",
      data: response.data.map(toRole),
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
    return toRole(response.data);
  },

  create: async (data: {
    name: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
  }): Promise<Role> => {
    // F-19 (ADR-105): the API stores every field the dialog offers.
    const body: CreateRoleInput = {
      name: data.name,
      description: data.description,
    };
    if (data.nameToShow !== undefined) body.nameToShow = data.nameToShow;
    if (data.roleLevel !== undefined) body.roleLevel = data.roleLevel;
    if (data.isActive !== undefined) {
      body.status = data.isActive ? "active" : "inactive";
    }
    const response = await api.post<BackendRoleResponse>("/api/v1/roles", body);
    return toRole(response.data);
  },

  update: async (data: {
    id: string;
    name?: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
    status?: UpdateRoleInput["status"];
  }): Promise<Role> => {
    // Backend updateRole reads { name, nameToShow, description, roleLevel, status }.
    const body: UpdateRoleInput = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.nameToShow !== undefined) body.nameToShow = data.nameToShow;
    if (data.description !== undefined) body.description = data.description;
    if (data.roleLevel !== undefined) body.roleLevel = data.roleLevel;
    if (data.status !== undefined) {
      body.status = data.status;
    } else if (data.isActive !== undefined) {
      body.status = data.isActive ? "active" : "inactive";
    }

    const response = await api.patch<BackendRoleResponse>(
      `/api/v1/roles/${data.id}`,
      body,
    );
    return toRole(response.data);
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
      meta?: ListMeta;
    }>("/api/v1/roles/menus", { params: { page, limit, search } });

    const total = response.meta?.total ?? response.data.length;
    const lim = response.meta?.limit ?? limit;
    const pg = response.meta?.page ?? page;

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
    }>(`/api/v1/roles/${roleId}/permissions`, { menuGroupId, permissionType } satisfies AssignPermissionInput);
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
    await api.post("/api/v1/roles/assign", { userId, roleId } satisfies AssignRoleInput);
  },

  removeRoleFromUser: async (userId: string): Promise<void> => {
    await api.delete(`/api/v1/roles/assign/${userId}`);
  },
};
