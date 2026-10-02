// src/api/services/role.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/roles.openapi.ts →
// @callibrator/contracts/roles), which replaced the interim `z.input` types
// (ADR-097 Am. 1). The exported names are unchanged.
//
// roles.controller answers its OWN shape, `{ success, data }` (plus a
// top-level `meta` on the two lists) — no `status`, no `message`. A role row
// carries `status` ("active" | "inactive"), never `isActive`; the service
// derives `isActive` from it (F-19: every role showed Inactive, and an edit
// re-activated an inactive one).
// NOTE: paths are NOT trailing-slashed — `/api/v1/roles/` 308-redirects on the Next proxy.
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";
import { Role, PaginatedResponse } from "@/types";

type CreateRoleBody = JsonBody<Op<"/api/v1/roles", "post">>;
type UpdateRoleBody = JsonBody<Op<"/api/v1/roles/{id}", "patch">>;

/** A role read by id also carries its menu permissions (RoleDetail). */
export type RoleDetail = components["schemas"]["RoleDetail"] & { isActive?: boolean };

/** A menu group as the roles menus endpoints answer it. */
export type RoleMenu = components["schemas"]["MenuGroupRow"];

export type RoleMenuPermission = components["schemas"]["RoleMenuPermissionRow"];

/** The row as the backend sends it, with `isActive` read from `status`. */
const toRole = <R extends Role>(row: R): R => ({
  ...row,
  // Defensive, as built: a row without `status` keeps its own `isActive`.
  isActive: row.status !== undefined ? row.status === "active" : row.isActive,
});

const byId = (id: string) => ({ params: { path: { id } } });

export const roleService = {
  getAll: async (
    page = 1,
    limit = 50,
    search?: string,
  ): Promise<PaginatedResponse<Role>> => {
    const response = await typedApi
      .GET("/api/v1/roles", {
        // The list reads `page` / `limit` raw from the query string (published as strings).
        params: { query: { page: String(page), limit: String(limit), search } },
      })
      .then(unwrap);

    const total = response.meta?.total ?? response.data.length;
    const lim = response.meta?.limit ?? limit;
    const pg = response.meta?.page ?? page;

    return {
      success: response.success,
      // roles.controller sends no `message` on a list.
      message: "",
      data: response.data.map(toRole),
      meta: {
        total,
        page: pg,
        limit: lim,
        totalPages: Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getById: async (roleId: string): Promise<RoleDetail> =>
    toRole((await typedApi.GET("/api/v1/roles/{id}", byId(roleId)).then(unwrap)).data),

  create: async (data: {
    name: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
  }): Promise<Role> => {
    // F-19 (ADR-105): the API stores every field the dialog offers.
    const body: CreateRoleBody = {
      name: data.name,
      description: data.description,
    };
    if (data.nameToShow !== undefined) body.nameToShow = data.nameToShow;
    if (data.roleLevel !== undefined) body.roleLevel = data.roleLevel;
    if (data.isActive !== undefined) {
      body.status = data.isActive ? "active" : "inactive";
    }
    return toRole((await typedApi.POST("/api/v1/roles", { body }).then(unwrap)).data);
  },

  update: async (data: {
    id: string;
    name?: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
    status?: UpdateRoleBody["status"];
  }): Promise<Role> => {
    // Backend updateRole reads { name, nameToShow, description, roleLevel, status }.
    const body: UpdateRoleBody = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.nameToShow !== undefined) body.nameToShow = data.nameToShow;
    if (data.description !== undefined) body.description = data.description;
    if (data.roleLevel !== undefined) body.roleLevel = data.roleLevel;
    if (data.status !== undefined) {
      body.status = data.status;
    } else if (data.isActive !== undefined) {
      body.status = data.isActive ? "active" : "inactive";
    }

    return toRole((await typedApi.PATCH("/api/v1/roles/{id}", { ...byId(data.id), body }).then(unwrap)).data);
  },

  delete: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/roles/{id}", byId(id));
  },

  // ------------------------------------------------------------------
  // MENU GROUPS (backend: /api/v1/roles/menus*)
  // ------------------------------------------------------------------

  getAllMenus: async (
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<PaginatedResponse<components["schemas"]["MenuGroupWithChildren"]>> => {
    const response = await typedApi
      .GET("/api/v1/roles/menus", {
        params: { query: { page: String(page), limit: String(limit), search } },
      })
      .then(unwrap);

    const total = response.meta?.total ?? response.data.length;
    const lim = response.meta?.limit ?? limit;
    const pg = response.meta?.page ?? page;

    return {
      success: response.success,
      message: "",
      data: response.data,
      meta: {
        total,
        page: pg,
        limit: lim,
        totalPages: Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getMenuById: async (menuId: string): Promise<components["schemas"]["MenuGroupWithChildren"]> =>
    (await typedApi.GET("/api/v1/roles/menus/{id}", byId(menuId)).then(unwrap)).data,

  // A-359 (2026-10-02): `createMenu` / `updateMenu` were removed. They sent
  // camelCase `parentId` / `sortOrder` / `isActive`, which the API drops (it
  // reads `parent_id` / `sort_order` / `is_active`), and nothing called them:
  // menu groups are created and edited through `menuGroupRole.service`.

  deleteMenu: async (menuId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/roles/menus/{id}", byId(menuId));
  },

  // ------------------------------------------------------------------
  // ROLE ↔ MENU PERMISSIONS (backend: /api/v1/roles/:roleId/permissions)
  // ------------------------------------------------------------------

  assignPermission: async (
    roleId: string,
    menuGroupId: string,
    permissionType: "read" | "write" = "read",
  ): Promise<RoleMenuPermission> =>
    (
      await typedApi
        .POST("/api/v1/roles/{roleId}/permissions", {
          params: { path: { roleId } },
          body: { menuGroupId, permissionType },
        })
        .then(unwrap)
    ).data,

  removePermission: async (
    roleId: string,
    menuGroupId: string,
  ): Promise<void> => {
    await typedApi.DELETE("/api/v1/roles/{roleId}/permissions/{menuGroupId}", {
      params: { path: { roleId, menuGroupId } },
    });
  },

  // ------------------------------------------------------------------
  // ROLE ↔ USER ASSIGNMENT (backend: /api/v1/roles/assign)
  // ------------------------------------------------------------------

  assignRoleToUser: async (userId: string, roleId: string): Promise<void> => {
    await typedApi.POST("/api/v1/roles/assign", { body: { userId, roleId } });
  },

  removeRoleFromUser: async (userId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/roles/assign/{userId}", { params: { path: { userId } } });
  },
};
