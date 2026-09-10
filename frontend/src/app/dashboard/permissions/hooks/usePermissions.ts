// src/app/dashboard/permissions/hooks/usePermissions.ts
import { useCallback, useEffect, useState } from "react";
import { roleService, RoleMenu } from "@/api/services/role.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { Role } from "@/types";

export type PermissionType = "read" | "write";

/** Role detail as returned by GET /api/v1/roles/:id (with nested permissions). */
interface RoleWithPermissions extends Role {
  permissions?: Array<{
    id?: string;
    roleId?: string;
    menuGroupId: string;
    permissionType?: PermissionType;
    menu?: {
      id: string;
      name: string;
      slug?: string;
      icon?: string;
    } | null;
  }>;
}

export function usePermissions() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();
  const isSuperAdmin = user?.role?.name === "SUPERADMIN";

  const [roles, setRoles] = useState<Role[]>([]);
  const [menus, setMenus] = useState<RoleMenu[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  // menuGroupId -> permissionType for the selected role
  const [assignments, setAssignments] = useState<
    Record<string, PermissionType>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRoleLoading, setIsRoleLoading] = useState(false);
  const [savingMenuId, setSavingMenuId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial load: all roles + all menu groups
  useEffect(() => {
    if (!isSuperAdmin) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [rolesRes, menusRes] = await Promise.all([
          roleService.getAll(1, 100),
          roleService.getAllMenus(1, 100),
        ]);
        if (cancelled) return;
        setRoles(rolesRes.data);
        setMenus(menusRes.data);
        if (rolesRes.data.length > 0) {
          setSelectedRoleId((prev) => prev || rolesRes.data[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load permissions",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  // Load the selected role's permission assignments
  const loadRolePermissions = useCallback(async (roleId: string) => {
    if (!roleId) return;
    setIsRoleLoading(true);
    setError(null);
    try {
      const role = (await roleService.getById(roleId)) as RoleWithPermissions;
      const map: Record<string, PermissionType> = {};
      (role.permissions || []).forEach((perm) => {
        const menuId = perm.menuGroupId || perm.menu?.id;
        if (menuId) map[menuId] = perm.permissionType || "read";
      });
      setAssignments(map);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load role permissions",
      );
    } finally {
      setIsRoleLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRoleId) loadRolePermissions(selectedRoleId);
  }, [selectedRoleId, loadRolePermissions]);

  /** Cycle none → read → write → none for a menu group. */
  const setPermission = async (
    menuGroupId: string,
    next: PermissionType | null,
  ) => {
    if (!selectedRoleId) return;
    setSavingMenuId(menuGroupId);
    setError(null);
    try {
      if (next === null) {
        await roleService.removePermission(selectedRoleId, menuGroupId);
        setAssignments((prev) => {
          const copy = { ...prev };
          delete copy[menuGroupId];
          return copy;
        });
        addToast({ type: "success", title: "Permission removed" });
      } else {
        await roleService.assignPermission(selectedRoleId, menuGroupId, next);
        setAssignments((prev) => ({ ...prev, [menuGroupId]: next }));
        addToast({ type: "success", title: `Permission set to ${next}` });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update permission";
      setError(message);
      addToast({ type: "error", title: message });
    } finally {
      setSavingMenuId(null);
    }
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  return {
    isSuperAdmin,
    roles,
    menus,
    selectedRoleId,
    setSelectedRoleId,
    selectedRole,
    assignments,
    isLoading,
    isRoleLoading,
    savingMenuId,
    error,
    setPermission,
    refresh: () => loadRolePermissions(selectedRoleId),
  };
}

export default usePermissions;
