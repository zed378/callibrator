import { useState, useEffect } from "react";
import { useRoleStore } from "@/stores/roleStore";
import { Role } from "@/types";
import { blankForm } from "../components/RolesHelpers";

export function useRoles() {
  const {
    roles,
    isLoading,
    error,
    fetchRoles,
    createRole,
    updateRole,
    refetchRoles,
    deleteRole,
  } = useRoleStore();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({ ...blankForm });
  const [editForm, setEditForm] = useState({ ...blankForm });
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchRoles(currentPage, pageSize, searchTerm);
  }, [fetchRoles, searchTerm, currentPage, pageSize]);

  const handleDelete = async (id: string) => {
    await deleteRole(id);
    setShowDeleteConfirm(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setIsSubmitting(true);
    try {
      await createRole({
        name: createForm.name,
        description: createForm.description || undefined,
        nameToShow: createForm.nameToShow || undefined,
        isActive: createForm.isActive,
        roleLevel: createForm.roleLevel,
      });
      setShowCreateModal(false);
      setCreateForm({ ...blankForm });
      await refetchRoles();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create role",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (role: Role) => {
    setEditingRole(role);
    setEditForm({
      name: role.name,
      description: role.description || "",
      nameToShow: role.nameToShow || "",
      isActive: role.isActive ?? true,
      roleLevel: role.roleLevel ?? 1,
    });
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      await updateRole({
        id: editingRole.id,
        name: editForm.name,
        description: editForm.description || undefined,
        nameToShow: editForm.nameToShow || undefined,
        isActive: editForm.isActive,
        roleLevel: editForm.roleLevel,
      });
      setShowEditModal(false);
      setEditingRole(null);
      await refetchRoles();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to update role",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const allRoles = roles?.data || [];
  const totalRoles = roles?.meta?.total || allRoles.length;
  const activeRoles = allRoles.filter((r) => r.isActive).length;
  const inactiveRoles = allRoles.length - activeRoles;

  return {
    roles,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    showCreateModal,
    setShowCreateModal,
    showEditModal,
    setShowEditModal,
    editingRole,
    showDeleteConfirm,
    setShowDeleteConfirm,
    createForm,
    setCreateForm,
    editForm,
    setEditForm,
    formError,
    isSubmitting,
    handleDelete,
    handleCreate,
    handleEdit,
    handleUpdate,
    totalRoles,
    activeRoles,
    inactiveRoles,
  };
}

export default useRoles;
