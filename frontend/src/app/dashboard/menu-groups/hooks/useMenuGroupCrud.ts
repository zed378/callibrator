// src/app/dashboard/menu-groups/hooks/useMenuGroupCrud.ts
import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/authStore";
import { menuGroupRoleService } from "@/api/services/menuGroupRole.service";
import type { MenuGroup } from "@/types";

export interface MenuGroupCrudForm {
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * The admin endpoint returns the raw menu group entity, which carries a few
 * extra fields on top of the personalized MenuGroup shape.
 */
type AdminMenuGroup = MenuGroup & {
  name?: string;
  slug?: string;
  isActive?: boolean;
};

const emptyForm: MenuGroupCrudForm = {
  name: "",
  slug: "",
  icon: "",
  sortOrder: 0,
  isActive: true,
};

interface UseMenuGroupCrudOptions {
  showToast: (
    type: "success" | "error" | "info",
    title: string,
    desc: string,
  ) => void;
  onMutated: () => Promise<void> | void;
}

export function useMenuGroupCrud({
  showToast,
  onMutated,
}: UseMenuGroupCrudOptions) {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role?.name === "SUPERADMIN";

  const [adminMenuGroups, setAdminMenuGroups] = useState<AdminMenuGroup[]>([]);
  const [crudModalOpen, setCrudModalOpen] = useState(false);
  const [crudModalType, setCrudModalType] = useState<"create" | "edit">(
    "create",
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [crudLoading, setCrudLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  const [crudForm, setCrudForm] = useState<MenuGroupCrudForm>(emptyForm);

  const fetchAdminMenuGroups = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      setAdminMenuGroups(await menuGroupRoleService.getAdminMenuGroups());
    } catch {
      // Non-blocking: edit modal falls back to the assignment list data.
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    fetchAdminMenuGroups();
  }, [fetchAdminMenuGroups]);

  const openCreateModal = () => {
    setCrudForm(emptyForm);
    setSelectedGroupId(null);
    setCrudModalType("create");
    setCrudModalOpen(true);
  };

  const openEditModal = (group: { id?: string; label?: string }) => {
    const admin = adminMenuGroups.find((g) => g.id === group.id);
    setCrudForm({
      name: admin?.name ?? admin?.label ?? group.label ?? "",
      slug: admin?.slug ?? "",
      icon: admin?.icon ?? "",
      sortOrder: admin?.sortOrder ?? 0,
      isActive: admin?.isActive ?? true,
    });
    setSelectedGroupId(group.id ?? null);
    setCrudModalType("edit");
    setCrudModalOpen(true);
  };

  const handleCrudSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crudForm.name.trim()) {
      showToast("error", "Name Required", "Please enter a menu group name.");
      return;
    }
    setCrudLoading(true);
    try {
      const payload = {
        name: crudForm.name.trim(),
        slug: crudForm.slug.trim() || undefined,
        icon: crudForm.icon.trim() || undefined,
        sortOrder: crudForm.sortOrder,
        isActive: crudForm.isActive,
      };
      if (crudModalType === "create") {
        await menuGroupRoleService.createMenuGroup(payload);
        showToast(
          "success",
          "Menu Group Created",
          "The menu group has been successfully created.",
        );
      } else {
        if (!selectedGroupId) return;
        await menuGroupRoleService.updateMenuGroup({
          id: selectedGroupId,
          ...payload,
        });
        showToast(
          "success",
          "Menu Group Updated",
          "The menu group has been successfully updated.",
        );
      }
      setCrudModalOpen(false);
      await Promise.all([fetchAdminMenuGroups(), onMutated()]);
    } catch (err: unknown) {
      showToast(
        "error",
        crudModalType === "create" ? "Creation Failed" : "Update Failed",
        err instanceof Error ? err.message : "Failed to save menu group",
      );
    } finally {
      setCrudLoading(false);
    }
  };

  const handleDeleteClick = (menuGroupId: string) => {
    setGroupToDelete(menuGroupId);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!groupToDelete) return;
    setCrudLoading(true);
    try {
      await menuGroupRoleService.deleteMenuGroup(groupToDelete);
      showToast(
        "success",
        "Menu Group Deleted",
        "The menu group has been successfully deleted.",
      );
      setDeleteConfirmOpen(false);
      setGroupToDelete(null);
      await Promise.all([fetchAdminMenuGroups(), onMutated()]);
    } catch (err: unknown) {
      showToast(
        "error",
        "Deletion Failed",
        err instanceof Error ? err.message : "Failed to delete menu group",
      );
    } finally {
      setCrudLoading(false);
    }
  };

  return {
    isSuperAdmin,
    adminMenuGroups,
    crudModalOpen,
    setCrudModalOpen,
    crudModalType,
    crudLoading,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    crudForm,
    setCrudForm,
    openCreateModal,
    openEditModal,
    handleCrudSubmit,
    handleDeleteClick,
    confirmDelete,
  };
}
