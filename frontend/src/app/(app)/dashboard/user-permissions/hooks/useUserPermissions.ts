// src/app/dashboard/user-permissions/hooks/useUserPermissions.ts
import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import {
  userPermissionService,
  UserPermissionsData,
  UserPermissionType,
} from "@/api/services/userPermission.service";
import { userService } from "@/api/services/user.service";
import { menuGroupRoleService } from "@/api/services/menuGroupRole.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { Role, User } from "@/types";

export function useUserPermissions() {
  const { user: currentUser } = useAuthStore();
  const { addToast } = useToastStore();
  const isSuperAdmin = currentUser?.role?.name === "SUPERADMIN";

  // User picker
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [isUsersLoading, setIsUsersLoading] = useState(true);

  // Roles (for the role assignment dropdown)
  const [roles, setRoles] = useState<Role[]>([]);

  // Permission data for the selected user
  const [data, setData] = useState<UserPermissionsData | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [savingMenuId, setSavingMenuId] = useState<string | null>(null);
  const [isRoleSaving, setIsRoleSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Available roles: loaded once. Not a super admin: nothing loads, and
  // `isUsersLoading` is derived false on return rather than set here
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const rolesRes = await menuGroupRoleService.getAvailableRoles();
        if (!cancelled) setRoles(rolesRes);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load roles");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  // Users, re-searched as the search term changes.
  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setIsUsersLoading(true);
      try {
        const usersRes = await userService.getAll(1, 50, search || undefined);
        if (cancelled) return;
        setUsers(usersRes.data);
        setSelectedUserId((prev) => prev || usersRes.data[0]?.id || "");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users");
        }
      } finally {
        if (!cancelled) setIsUsersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, search]);

  const loadPermissions = useCallback(async (userId: string) => {
    if (!userId) return;
    setIsDataLoading(true);
    setError(null);
    try {
      setData(await userPermissionService.getUserPermissions(userId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load user permissions",
      );
    } finally {
      setIsDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    return deferEffect(() => loadPermissions(selectedUserId));
  }, [selectedUserId, loadPermissions]);

  /** Set a custom override, or null to restore role inheritance. */
  const setOverride = async (
    menuGroupId: string,
    override: UserPermissionType | null,
  ) => {
    if (!selectedUserId) return;
    setSavingMenuId(menuGroupId);
    setError(null);
    try {
      if (override === null) {
        await userPermissionService.removeUserPermission(
          selectedUserId,
          menuGroupId,
        );
        addToast({ type: "success", title: "Restored role inheritance" });
      } else {
        await userPermissionService.setUserPermission(
          selectedUserId,
          menuGroupId,
          override,
        );
        addToast({
          type: "success",
          title:
            override === "none"
              ? "Access denied for this menu"
              : `Custom ${override} access granted`,
        });
      }
      await loadPermissions(selectedUserId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update permission";
      setError(message);
      addToast({ type: "error", title: message });
    } finally {
      setSavingMenuId(null);
    }
  };

  /** Change the user's role (base inheritance). */
  const changeRole = async (roleId: string) => {
    if (!selectedUserId || !roleId) return;
    setIsRoleSaving(true);
    setError(null);
    try {
      await userService.updateRole(selectedUserId, roleId);
      addToast({ type: "success", title: "Role updated" });
      await loadPermissions(selectedUserId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update role";
      setError(message);
      addToast({ type: "error", title: message });
    } finally {
      setIsRoleSaving(false);
    }
  };

  return {
    isSuperAdmin,
    users,
    search,
    setSearch,
    selectedUserId,
    setSelectedUserId,
    roles,
    data: selectedUserId ? data : null,
    isUsersLoading: isSuperAdmin && isUsersLoading,
    isDataLoading,
    savingMenuId,
    isRoleSaving,
    error,
    setOverride,
    changeRole,
    refresh: () => loadPermissions(selectedUserId),
  };
}

export default useUserPermissions;
