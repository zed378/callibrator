import { api } from "../client";
import type {
  Role,
  BulkAssignmentResult,
  BulkRevokeResult,
  MenuGroup,
} from "@/types";

interface AssignMenuGroupPayload {
  menuGroupId: string;
  roleId: string;
  notes?: string;
}

interface RevokeMenuGroupPayload {
  menuGroupId: string;
  roleId: string;
}

interface AssignMenuItemPayload {
  menuItemId: string;
  roleId: string;
  notes?: string;
}

interface RevokeMenuItemPayload {
  menuItemId: string;
  roleId: string;
}

interface BulkAssignMenuGroupsPayload {
  roleId: string;
  menuGroupIds: string[];
  notes?: string;
}

interface BulkRevokeMenuGroupsPayload {
  roleId: string;
  menuGroupIds: string[];
}

// Backend response wrappers
interface BackendListResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

export interface MenuGroupCreateInput {
  name: string;
  slug?: string;
  icon?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface MenuGroupUpdateInput extends Partial<MenuGroupCreateInput> {
  id: string;
}

class MenuGroupRoleService {
  /**
   * Get all menu groups (admin view, SUPERADMIN only).
   * Backend route: GET /api/v1/menu-groups/menu-groups/admin
   */
  async getAdminMenuGroups(): Promise<MenuGroup[]> {
    const response = await api.get<BackendListResponse<MenuGroup[]>>(
      "/api/v1/menu-groups/menu-groups/admin",
    );
    return response?.data || [];
  }

  /**
   * Create a menu group (SUPERADMIN only).
   * Backend route: POST /api/v1/menu-groups/create
   */
  async createMenuGroup(payload: MenuGroupCreateInput): Promise<MenuGroup> {
    const response = await api.post<BackendListResponse<MenuGroup>>(
      "/api/v1/menu-groups/create",
      payload,
    );
    return response.data;
  }

  /**
   * Update a menu group (SUPERADMIN only).
   * Backend route: POST /api/v1/menu-groups/update
   */
  async updateMenuGroup(payload: MenuGroupUpdateInput): Promise<MenuGroup> {
    const response = await api.post<BackendListResponse<MenuGroup>>(
      "/api/v1/menu-groups/update",
      payload,
    );
    return response.data;
  }

  /**
   * Delete a menu group (SUPERADMIN only).
   * Backend route: POST /api/v1/menu-groups/delete
   */
  async deleteMenuGroup(menuGroupId: string): Promise<void> {
    await api.post<BackendListResponse<null>>("/api/v1/menu-groups/delete", {
      menuGroupId,
    });
  }

  /**
   * Get available menu groups for a specific role (personalized menu).
   * Backend route: GET /api/v1/menu-groups/menu-groups?roleId={roleId}
   */
  async getAvailableMenuGroups(roleId: string): Promise<MenuGroup[]> {
    const response = await api.get<BackendListResponse<MenuGroup[]>>(
      "/api/v1/menu-groups/menu-groups",
      { params: { roleId } },
    );
    return response?.data || [];
  }

  /**
   * Get available roles for menu assignment (admin-only).
   * Backend route: GET /api/v1/menu-groups/roles
   */
  async getAvailableRoles(): Promise<Role[]> {
    const response = await api.get<BackendListResponse<Role[]>>(
      "/api/v1/menu-groups/roles",
    );
    return response?.data || [];
  }

  /**
   * Get personalized menu for a role (POST variant).
   * Backend route: POST /api/v1/menu-groups/get-assignments
   */
  async getPersonalizedMenu(roleId: string): Promise<MenuGroup[]> {
    const response = await api.post<BackendListResponse<MenuGroup[]>>(
      "/api/v1/menu-groups/get-assignments",
      { roleId },
    );
    return response?.data || [];
  }

  /**
   * Filter menu groups with custom criteria.
   * Backend route: POST /api/v1/menu-groups/filter
   */
  async filterMenuGroups(filters: {
    roleId?: string;
    tenantId?: string;
  }): Promise<MenuGroup[]> {
    const response = await api.post<BackendListResponse<MenuGroup[]>>(
      "/api/v1/menu-groups/filter",
      filters,
    );
    return response?.data || [];
  }

  async assignMenuGroupToRole(payload: AssignMenuGroupPayload): Promise<Role> {
    const response = await api.post<BackendListResponse<Role>>(
      "/api/v1/menu-groups/assign",
      payload,
    );
    return response.data;
  }

  async revokeMenuGroupFromRole(
    payload: RevokeMenuGroupPayload,
  ): Promise<Role> {
    const response = await api.post<BackendListResponse<Role>>(
      "/api/v1/menu-groups/revoke",
      payload,
    );
    return response.data;
  }

  async assignMenuItemToRole(payload: AssignMenuItemPayload): Promise<Role> {
    const response = await api.post<BackendListResponse<Role>>(
      "/api/v1/menu-groups/assign-item",
      payload,
    );
    return response.data;
  }

  async revokeMenuItemFromRole(payload: RevokeMenuItemPayload): Promise<Role> {
    const response = await api.post<BackendListResponse<Role>>(
      "/api/v1/menu-groups/revoke-item",
      payload,
    );
    return response.data;
  }

  async bulkAssignMenuGroups(
    payload: BulkAssignMenuGroupsPayload,
  ): Promise<BulkAssignmentResult> {
    const response = await api.post<BackendListResponse<BulkAssignmentResult>>(
      "/api/v1/menu-groups/bulk-assign",
      payload,
    );
    return response.data;
  }

  async bulkRevokeMenuGroups(
    payload: BulkRevokeMenuGroupsPayload,
  ): Promise<BulkRevokeResult> {
    const response = await api.post<BackendListResponse<BulkRevokeResult>>(
      "/api/v1/menu-groups/bulk-revoke",
      payload,
    );
    return response.data;
  }
}

export const menuGroupRoleService = new MenuGroupRoleService();
