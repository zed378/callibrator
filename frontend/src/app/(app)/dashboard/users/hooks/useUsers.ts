// src/app/dashboard/users/hooks/useUsers.ts
import { useState, useEffect, useCallback, useRef } from "react";
import { useUserStore } from "@/stores/userStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuthStore } from "@/stores/authStore";
import { User, Role, Tenant } from "@/types";
import { userService } from "@/api/services/user.service";
import { menuGroupRoleService } from "@/api/services/menuGroupRole.service";
import { toneOf, type StatusTone } from "@/lib/statusTone";

export const initialCreateForm = {
  firstName: "",
  lastName: "",
  username: "",
  email: "",
  password: "",
  roleId: "",
  tenantId: "",
};

export const initialEditForm = {
  firstName: "",
  lastName: "",
  username: "",
  email: "",
  status: "",
};

export function useUsers() {
  const {
    users,
    isLoading,
    error,
    fetchUsers,
    createUser,
    updateUser,
    refetchUsers,
    deleteUser,
  } = useUserStore();
  const [roles, setRoles] = useState<Role[]>([]);
  const { tenants, fetchTenants } = useTenantStore();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [createForm, setCreateForm] = useState({ ...initialCreateForm });
  const [editForm, setEditForm] = useState({ ...initialEditForm });
  const [passwordRules, setPasswordRules] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: false,
  });
  const [usernameAvailability, setUsernameAvailability] = useState<{
    checking: boolean;
    available: boolean | null;
  }>({ checking: false, available: null });

  const usernameDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    fetchUsers(currentPage, pageSize, searchTerm);
  }, [fetchUsers, searchTerm, currentPage, pageSize]);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const fetchedRoles = await menuGroupRoleService.getAvailableRoles();
        setRoles(fetchedRoles);
      } catch (error) {
        console.error("Failed to fetch roles:", error);
      }
    };
    fetchRoles();
  }, []);

  // A-76: only a super admin may list every tenant; anyone else gets their
  // own tenant as the single option (the backend stamps it for them anyway).
  const authUser = useAuthStore((state) => state.user);
  const isPlatformAdmin =
    authUser?.role?.name === "SUPERADMIN" || authUser?.role?.name === "SUPER_ADMIN";
  const ownTenantId = isPlatformAdmin ? null : (authUser?.tenantId ?? null);

  useEffect(() => {
    if (!authUser) return;
    fetchTenants(1, 100, undefined, ownTenantId);
  }, [fetchTenants, authUser, ownTenantId]);

  useEffect(() => {
    return () => {
      if (usernameDebounceTimerRef.current)
        clearTimeout(usernameDebounceTimerRef.current);
    };
  }, []);

  const checkUsernameAvailability = useCallback(
    (username: string, isEditing?: boolean, existingUsername?: string) => {
      if (usernameDebounceTimerRef.current)
        clearTimeout(usernameDebounceTimerRef.current);
      if (username.trim().length < 3) {
        setUsernameAvailability({ checking: false, available: null });
        return;
      }
      if (isEditing && username === existingUsername) {
        setUsernameAvailability({ checking: false, available: null });
        return;
      }
      // Immediately show checking state
      setUsernameAvailability({ checking: true, available: null });
      usernameDebounceTimerRef.current = setTimeout(async () => {
        try {
          const result = await userService.checkUsername(username);
          setUsernameAvailability({
            checking: false,
            available: result.available,
          });
        } catch (error) {
          console.error("Username check failed:", error);
          // Keep the last known state or set to unavailable on error
          setUsernameAvailability({
            checking: false,
            available: null,
          });
        }
      }, 300);
    },
    [],
  );

  const validatePassword = (password: string) => {
    setPasswordRules({
      minLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /\d/.test(password),
      hasSymbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password),
    });
  };

  const handleDelete = async (id: string) => {
    await deleteUser(id);
    setShowDeleteConfirm(null);
  };

  const handleDeleteRequest = (id: string) => setShowDeleteConfirm(id);

  const handleCancelCreate = () => {
    setShowCreateModal(false);
    setCreateForm({ ...initialCreateForm });
    setPasswordRules({
      minLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSymbol: false,
    });
    setUsernameAvailability({ checking: false, available: null });
    setFormError("");
    setIsSubmitting(false);
  };

  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditForm({ ...initialEditForm });
    setEditingUser(null);
    setUsernameAvailability({ checking: false, available: null });
    setFormError("");
    setIsSubmitting(false);
  };

  // F-19: a photo picked in either dialog was only ever previewed — nothing
  // called uploadAvatar, so it was lost on save. The files are kept here and
  // sent (POST /users/:userId/avatar) once the user itself is saved.
  const [createPhotoFile, setCreatePhotoFile] = useState<File | null>(null);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const [photoNotice, setPhotoNotice] = useState("");

  const photoFailure = (err: unknown) =>
    err instanceof Error ? err.message : "the upload failed";

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setIsSubmitting(true);
    const pwRegex =
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]).{8,}$/;
    if (!pwRegex.test(createForm.password)) {
      setFormError(
        "Password must be at least 8 characters and contain uppercase, lowercase, number, and special character",
      );
      setIsSubmitting(false);
      return;
    }
    try {
      const created = await createUser({
        ...createForm,
        tenantId: createForm.tenantId || undefined,
      });
      // The user exists now, so the dialog closes whatever the photo does —
      // resubmitting would create a second user. A refused photo is said on
      // the page instead.
      if (createPhotoFile && created?.id) {
        try {
          await userService.uploadAvatar(created.id, createPhotoFile);
        } catch (err: unknown) {
          setPhotoNotice(
            `The user was created, but the photo was not saved: ${photoFailure(err)}. Add it from the user's Edit dialog.`,
          );
        }
      }
      setCreatePhotoFile(null);
      setShowCreateModal(false);
      setCreateForm({ ...initialCreateForm });
      setPasswordRules({
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSymbol: false,
      });
      await refetchUsers();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create user",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditPhotoFile(null);
    setEditPhotoRemoved(false);
    setEditingUser(user);
    setEditForm({
      username: user.username || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email,
      status: user.status ?? "",
    });
    setShowEditModal(true);
    setTimeout(() => {
      checkUsernameAvailability(
        user.username || "",
        true,
        user.username || undefined,
      );
    }, 100);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      await updateUser({
        userId: editingUser.id,
        username: editForm.username || undefined,
        // The edit form offers the names; dropping them here made every name
        // change a silent no-op (PATCH /users/edit accepts both).
        firstName: editForm.firstName || undefined,
        lastName: editForm.lastName || undefined,
        email: editForm.email || undefined,
        status: editForm.status || undefined,
      });
      // Saving again is harmless, so a refused photo keeps the dialog open
      // with the reason.
      try {
        if (editPhotoFile) {
          await userService.uploadAvatar(editingUser.id, editPhotoFile);
        } else if (editPhotoRemoved && editingUser.picture) {
          await userService.deleteAvatar(editingUser.id);
        }
      } catch (err: unknown) {
        setFormError(
          `The details were saved, but the photo was not: ${photoFailure(err)}`,
        );
        return;
      }
      setEditPhotoFile(null);
      setEditPhotoRemoved(false);
      setShowEditModal(false);
      setEditingUser(null);
      await refetchUsers();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to update user",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ADR-122 (P11-05): a user's status tone comes from the one registry.
  const getStatusColor = (status: string): StatusTone => toneOf("user", status);

  // Only a super admin may assign the SUPER_ADMIN role, so hide that option
  // from the role dropdown for everyone else (mirrors the backend guard).
  const { user: currentUser } = useAuthStore();
  const currentIsSuperAdmin =
    currentUser?.role?.name === "SUPERADMIN" ||
    currentUser?.role?.name === "SUPER_ADMIN";

  const roleOptions: { value: string; label: string }[] = roles
    .filter(
      (role: Role) =>
        currentIsSuperAdmin ||
        !(role.name === "SUPERADMIN" || role.name === "SUPER_ADMIN"),
    )
    .map((role: Role) => ({
      value: role.id,
      label: role.nameToShow || role.name,
    }));

  const tenantOptions: { value: string; label: string }[] =
    tenants?.data?.map((tenant: Tenant) => ({
      value: tenant.id,
      label: tenant.name,
    })) || [];

  const statusOptions = [
    { value: "ACTIVE", label: "ACTIVE" },
    { value: "INACTIVE", label: "INACTIVE" },
    { value: "SUSPENDED", label: "SUSPENDED" },
    { value: "PENDING", label: "PENDING" },
  ];

  const usersList = Array.isArray(users?.data) ? users.data : [];

  return {
    users,
    isLoading,
    error,
    setCreatePhotoFile,
    setEditPhotoFile,
    setEditPhotoRemoved,
    photoNotice,
    setPhotoNotice,
    searchTerm,
    setSearchTerm,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showCreateModal,
    setShowCreateModal,
    showEditModal,
    setShowEditModal,
    editingUser,
    formError,
    isSubmitting,
    createForm,
    setCreateForm,
    editForm,
    setEditForm,
    passwordRules,
    usernameAvailability,
    checkUsernameAvailability,
    validatePassword,
    handleDelete,
    handleDeleteRequest,
    handleCancelCreate,
    handleCancelEdit,
    handleCreate,
    handleEdit,
    handleUpdate,
    getStatusColor,
    roleOptions,
    tenantOptions,
    statusOptions,
    usersList,
  };
}
