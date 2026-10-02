// src/api/services/userPermission.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call and every type is
// read off `paths` (generated from backend/src/routes/api/userPermissions.openapi.ts);
// the exported names are unchanged, so no caller changed.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op } from "../typed";

// Backend routes (SUPERADMIN only):
//   GET    /api/v1/user-permissions/:userId
//   POST   /api/v1/user-permissions/:userId              { menuGroupId, permissionType, notes? }
//   DELETE /api/v1/user-permissions/:userId/:menuGroupId
//
// Semantics: a user inherits permissions from their role; a custom override
// ("read"/"write") replaces the role permission for that menu, and "none"
// explicitly denies it. Removing the override restores role inheritance.

type ById = "/api/v1/user-permissions/{userId}";

export type UserPermissionType = JsonBody<Op<ById, "post">>["permissionType"];
export type UserPermissionsData = DataOf<Op<ById, "get">>;
export type EffectivePermission = UserPermissionsData["effective"][number];
export type PermissionMenu = NonNullable<EffectivePermission["menu"]>;

export const userPermissionService = {
  /** Full permission picture for one user (role + custom + effective). */
  getUserPermissions: async (userId: string): Promise<UserPermissionsData> =>
    (await typedApi.GET("/api/v1/user-permissions/{userId}", { params: { path: { userId } } }).then(unwrap)).data,

  /** Upsert a custom override ("read" | "write" | "none"). */
  setUserPermission: async (
    userId: string,
    menuGroupId: string,
    permissionType: UserPermissionType,
    notes?: string,
  ): Promise<void> => {
    await typedApi.POST("/api/v1/user-permissions/{userId}", {
      params: { path: { userId } },
      body: { menuGroupId, permissionType, notes },
    });
  },

  /** Remove an override — user falls back to role inheritance. */
  removeUserPermission: async (userId: string, menuGroupId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/user-permissions/{userId}/{menuGroupId}", {
      params: { path: { userId, menuGroupId } },
    });
  },
};
