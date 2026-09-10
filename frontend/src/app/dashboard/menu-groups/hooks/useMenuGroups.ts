// src/app/dashboard/menu-groups/hooks/useMenuGroups.ts
import { useState, useEffect, useCallback } from "react";
import { menuGroupRoleService } from "@/api/services/menuGroupRole.service";
import type { Role, BulkAssignmentResult, BulkRevokeResult } from "@/types";
import type { ExtendedMenuGroup, ExtendedMenuItem } from "../types";

export interface ToastData {
  type: "success" | "error" | "info";
  title: string;
  description: string;
}

export function useMenuGroups() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [menuGroups, setMenuGroups] = useState<ExtendedMenuGroup[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [assignNotes, setAssignNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const showToast = (
    type: "success" | "error" | "info",
    title: string,
    desc: string,
  ) => {
    setToast({ type, title, description: desc });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoles(await menuGroupRoleService.getAvailableRoles());
      setMenuGroups(
        selectedRoleId
          ? (
              await menuGroupRoleService.getAvailableMenuGroups(selectedRoleId)
            ).map((g) => ({ ...g, isAssigned: g.isAssigned ?? false }))
          : [],
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [selectedRoleId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const handleAssign = async (menuGroupId: string) => {
    if (!selectedRoleId) {
      showToast("error", "Role Required", "Please select a role first.");
      return;
    }
    setActionLoading(true);
    try {
      await menuGroupRoleService.assignMenuGroupToRole({
        menuGroupId,
        roleId: selectedRoleId,
        notes: assignNotes || undefined,
      });
      showToast(
        "success",
        "Menu Group Assigned",
        "The menu group has been successfully assigned to the role.",
      );
      await fetchData();
      setAssignNotes("");
    } catch (err: unknown) {
      showToast(
        "error",
        "Assignment Failed",
        err instanceof Error ? err.message : "Failed to assign menu group",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevoke = async (menuGroupId: string) => {
    if (!selectedRoleId) return;
    setActionLoading(true);
    try {
      await menuGroupRoleService.revokeMenuGroupFromRole({
        menuGroupId,
        roleId: selectedRoleId,
      });
      showToast(
        "success",
        "Menu Group Revoked",
        "The menu group has been successfully revoked from the role.",
      );
      await fetchData();
    } catch (err: unknown) {
      showToast(
        "error",
        "Revocation Failed",
        err instanceof Error ? err.message : "Failed to revoke menu group",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkAssign = async () => {
    if (!selectedRoleId) {
      showToast("error", "Role Required", "Please select a role first.");
      return;
    }
    const selectedGroups = menuGroups
      .filter((g) => g.isAssigned)
      .map((g) => g.id!);
    if (!selectedGroups.length) {
      showToast(
        "error",
        "No Selection",
        "Please select at least one menu group.",
      );
      return;
    }
    setActionLoading(true);
    try {
      const result: BulkAssignmentResult =
        await menuGroupRoleService.bulkAssignMenuGroups({
          roleId: selectedRoleId,
          menuGroupIds: selectedGroups,
          notes: assignNotes || undefined,
        });
      let desc = `Successfully assigned ${result.assigned.length} menu group(s).`;
      if (result.alreadyAssigned.length)
        desc += ` ${result.alreadyAssigned.length} already assigned.`;
      if (result.failed.length) desc += ` ${result.failed.length} failed.`;
      showToast("success", "Bulk Assignment Complete", desc);
      await fetchData();
      setAssignNotes("");
    } catch (err: unknown) {
      showToast(
        "error",
        "Bulk Assignment Failed",
        err instanceof Error ? err.message : "Bulk assignment failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkRevoke = async () => {
    if (!selectedRoleId) return;
    const assignedGroups = menuGroups
      .filter((g) => g.isAssigned)
      .map((g) => g.id!);
    if (!assignedGroups.length) {
      showToast("error", "No Selection", "No assigned menu groups to revoke.");
      return;
    }
    setActionLoading(true);
    try {
      const result: BulkRevokeResult =
        await menuGroupRoleService.bulkRevokeMenuGroups({
          roleId: selectedRoleId,
          menuGroupIds: assignedGroups,
        });
      showToast(
        "success",
        "Bulk Revocation Complete",
        `Successfully revoked ${result.revoked.length} menu group(s).`,
      );
      await fetchData();
    } catch (err: unknown) {
      showToast(
        "error",
        "Bulk Revocation Failed",
        err instanceof Error ? err.message : "Bulk revocation failed",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const toggleAssign = async (menuGroupId: string, assigned: boolean) => {
    if (!selectedRoleId) return;
    setMenuGroups((prev) =>
      prev.map((g) =>
        g.id === menuGroupId ? { ...g, isAssigned: assigned } : g,
      ),
    );
    try {
      if (assigned) {
        await menuGroupRoleService.assignMenuGroupToRole({
          menuGroupId,
          roleId: selectedRoleId,
          notes: assignNotes || undefined,
        });
        showToast(
          "success",
          "Menu Group Assigned",
          "The menu group has been successfully assigned to the role.",
        );
      } else {
        await menuGroupRoleService.revokeMenuGroupFromRole({
          menuGroupId,
          roleId: selectedRoleId,
        });
        showToast(
          "success",
          "Menu Group Revoked",
          "The menu group has been successfully revoked from the role.",
        );
      }
    } catch (err: unknown) {
      showToast(
        "error",
        "Toggle Failed",
        err instanceof Error ? err.message : "Failed to toggle menu group",
      );
      setMenuGroups((prev) =>
        prev.map((g) =>
          g.id === menuGroupId ? { ...g, isAssigned: !assigned } : g,
        ),
      );
    }
  };

  const toggleItemAssign = async (
    group: ExtendedMenuGroup,
    item: ExtendedMenuItem,
    checked: boolean,
  ) => {
    if (!selectedRoleId) return;
    const id = item.id || "";
    const setItemState = (items: ExtendedMenuItem[], val: boolean) =>
      items.map((menuItem) =>
        menuItem.id !== id ? menuItem : { ...menuItem, isAssigned: val },
      );
    setMenuGroups((prev) =>
      prev.map((g) =>
        g.id !== group.id
          ? g
          : { ...g, items: setItemState(g.items || [], checked as boolean) },
      ),
    );
    try {
      if (group.isAssigned) {
        await menuGroupRoleService.revokeMenuItemFromRole({
          menuItemId: id,
          roleId: selectedRoleId,
        });
        showToast("success", "Item Revoked", "Menu item has been revoked.");
        setMenuGroups((prev) =>
          prev.map((g) =>
            g.id !== group.id
              ? g
              : { ...g, items: setItemState(g.items || [], false) },
          ),
        );
      } else if (checked) {
        await menuGroupRoleService.assignMenuItemToRole({
          menuItemId: id,
          roleId: selectedRoleId,
          notes: assignNotes || undefined,
        });
        showToast("success", "Item Assigned", "Menu item has been assigned.");
      } else {
        await menuGroupRoleService.revokeMenuItemFromRole({
          menuItemId: id,
          roleId: selectedRoleId,
        });
        showToast("success", "Item Revoked", "Menu item has been revoked.");
        setMenuGroups((prev) =>
          prev.map((g) =>
            g.id !== group.id
              ? g
              : { ...g, items: setItemState(g.items || [], false) },
          ),
        );
      }
    } catch (err: unknown) {
      showToast(
        "error",
        "Toggle Failed",
        err instanceof Error ? err.message : "Failed to toggle menu item",
      );
      setMenuGroups((prev) =>
        prev.map((g) =>
          g.id !== group.id
            ? g
            : { ...g, items: setItemState(g.items || [], !checked) },
        ),
      );
    }
  };

  const isItemAssigned = (group: ExtendedMenuGroup, item: ExtendedMenuItem) =>
    group.isAssigned || item.isAssigned === true;

  const getGroupAssignmentState = (
    group: ExtendedMenuGroup,
  ): "all" | "none" | "some" => {
    if (group.isAssigned) return "all";
    const items = group.items;
    if (!items?.length) return "none";
    const c = items.filter((i) => i.isAssigned === true).length;
    return c === 0 ? "none" : c === items.length ? "all" : "some";
  };

  return {
    roles,
    menuGroups,
    selectedRoleId,
    setSelectedRoleId,
    loading,
    actionLoading,
    assignNotes,
    setAssignNotes,
    error,
    toast,
    toggleAssign,
    handleAssign,
    handleRevoke,
    handleBulkAssign,
    handleBulkRevoke,
    toggleItemAssign,
    isItemAssigned,
    getGroupAssignmentState,
    showToast,
    refresh: fetchData,
  };
}
