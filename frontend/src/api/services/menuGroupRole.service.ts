// src/api/services/menuGroupRole.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/menuGroups.openapi.ts →
// @callibrator/contracts/menuGroup). The exported names are unchanged.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";
import type { Role, BulkAssignmentResult, BulkRevokeResult, MenuGroup } from "@/types";

type M = "/api/v1/menu-groups";

/**
 * A menu entry as every tree read and the create/update answer it: `label`,
 * `path` (from the slug) and `items` (its children, recursively).
 */
export type MenuEntry = components["schemas"]["MenuGroupNode"];

/**
 * The tree as the app's MenuGroup view. As built: the view types `icon` as a
 * string; the API sends null for a group without one, which the sidebar's
 * icon lookup already falls back from.
 */
const asMenuGroups = (entries: MenuEntry[]): MenuGroup[] => entries as unknown as MenuGroup[];

export type MenuGroupCreateInput = JsonBody<Op<`${M}/create`, "post">>;
export type MenuGroupUpdateInput = JsonBody<Op<`${M}/update`, "post">>;

type AssignMenuGroupPayload = JsonBody<Op<`${M}/assign`, "post">>;
type RevokeMenuGroupPayload = JsonBody<Op<`${M}/revoke`, "post">>;
type AssignMenuItemPayload = JsonBody<Op<`${M}/assign-item`, "post">>;
type RevokeMenuItemPayload = JsonBody<Op<`${M}/revoke-item`, "post">>;
type BulkAssignMenuGroupsPayload = JsonBody<Op<`${M}/bulk-assign`, "post">>;
type BulkRevokeMenuGroupsPayload = JsonBody<Op<`${M}/bulk-revoke`, "post">>;

/** What an assignment answers: the role's permission row on the menu group. */
export type RoleMenuGrant = DataOf<Op<`${M}/assign`, "post">>;

/**
 * ADR-102 — the caller's EFFECTIVE menu permissions, as the API gate computes
 * them (role grants inherited one level down, replaced by per-user overrides).
 * `permissions` holds only the slugs the caller has; `superAdmin` passes every
 * menu gate.
 */
export type EffectivePermissions = DataOf<Op<`${M}/my-permissions`, "get">>;

class MenuGroupRoleService {
  /**
   * Get all menu groups (admin view, SUPERADMIN only).
   * Backend route: GET /api/v1/menu-groups/menu-groups/admin
   */
  async getAdminMenuGroups(): Promise<MenuGroup[]> {
    const response = await typedApi.GET("/api/v1/menu-groups/menu-groups/admin").then(unwrap);
    // Defensive, as built: a body without rows reads as none.
    return asMenuGroups(response?.data || []);
  }

  /**
   * Create a menu group (SUPERADMIN only).
   * Backend route: POST /api/v1/menu-groups/create
   */
  async createMenuGroup(payload: MenuGroupCreateInput): Promise<MenuEntry> {
    return (await typedApi.POST("/api/v1/menu-groups/create", { body: payload }).then(unwrap)).data;
  }

  /**
   * Update a menu group (SUPERADMIN only).
   * Backend route: POST /api/v1/menu-groups/update
   */
  async updateMenuGroup(payload: MenuGroupUpdateInput): Promise<MenuEntry> {
    return (await typedApi.POST("/api/v1/menu-groups/update", { body: payload }).then(unwrap)).data;
  }

  /**
   * Delete a menu group (SUPERADMIN only).
   * Backend route: POST /api/v1/menu-groups/delete
   */
  async deleteMenuGroup(menuGroupId: string): Promise<void> {
    await typedApi.POST("/api/v1/menu-groups/delete", { body: { menuGroupId } });
  }

  /**
   * Get available menu groups for a specific role (personalized menu).
   * Backend route: GET /api/v1/menu-groups/menu-groups?roleId={roleId}
   */
  async getAvailableMenuGroups(roleId: string): Promise<MenuGroup[]> {
    const response = await typedApi
      .GET("/api/v1/menu-groups/menu-groups", { params: { query: { roleId } } })
      .then(unwrap);
    return asMenuGroups(response?.data || []);
  }

  /**
   * Get available roles for menu assignment (admin-only).
   * Backend route: GET /api/v1/menu-groups/roles
   */
  async getAvailableRoles(): Promise<Role[]> {
    const response = await typedApi.GET("/api/v1/menu-groups/roles").then(unwrap);
    return response?.data || [];
  }

  /**
   * ADR-102 — the caller's effective permissions.
   * Backend route: GET /api/v1/menu-groups/my-permissions
   */
  async getMyPermissions(): Promise<EffectivePermissions> {
    const response = await typedApi.GET("/api/v1/menu-groups/my-permissions").then(unwrap);
    // Defensive, as built: a body without `data` grants nothing.
    return {
      superAdmin: response?.data?.superAdmin === true,
      permissions: response?.data?.permissions ?? {},
    };
  }

  /**
   * Get personalized menu for a role (POST variant).
   * Backend route: POST /api/v1/menu-groups/get-assignments
   */
  async getPersonalizedMenu(roleId: string): Promise<MenuGroup[]> {
    const response = await typedApi
      .POST("/api/v1/menu-groups/get-assignments", { body: { roleId } })
      .then(unwrap);
    return asMenuGroups(response?.data || []);
  }

  /**
   * Filter menu groups with custom criteria.
   * Backend route: POST /api/v1/menu-groups/filter
   */
  async filterMenuGroups(filters: {
    roleId?: string;
    tenantId?: string;
  }): Promise<MenuGroup[]> {
    // As built: `tenantId` rides along; the filter body reads only `roleId`.
    const body = filters;
    const response = await typedApi.POST("/api/v1/menu-groups/filter", { body }).then(unwrap);
    return asMenuGroups(response?.data || []);
  }

  async assignMenuGroupToRole(payload: AssignMenuGroupPayload): Promise<RoleMenuGrant> {
    return (await typedApi.POST("/api/v1/menu-groups/assign", { body: payload }).then(unwrap)).data;
  }

  /** The answer carries no data (the published envelope has none). */
  async revokeMenuGroupFromRole(payload: RevokeMenuGroupPayload): Promise<void> {
    await typedApi.POST("/api/v1/menu-groups/revoke", { body: payload });
  }

  async assignMenuItemToRole(payload: AssignMenuItemPayload): Promise<RoleMenuGrant> {
    return (await typedApi.POST("/api/v1/menu-groups/assign-item", { body: payload }).then(unwrap)).data;
  }

  async revokeMenuItemFromRole(payload: RevokeMenuItemPayload): Promise<void> {
    await typedApi.POST("/api/v1/menu-groups/revoke-item", { body: payload });
  }

  async bulkAssignMenuGroups(payload: BulkAssignMenuGroupsPayload): Promise<BulkAssignmentResult> {
    return (await typedApi.POST("/api/v1/menu-groups/bulk-assign", { body: payload }).then(unwrap)).data;
  }

  async bulkRevokeMenuGroups(payload: BulkRevokeMenuGroupsPayload): Promise<BulkRevokeResult> {
    return (await typedApi.POST("/api/v1/menu-groups/bulk-revoke", { body: payload }).then(unwrap)).data;
  }
}

export const menuGroupRoleService = new MenuGroupRoleService();
