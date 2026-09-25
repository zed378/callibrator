// src/app/dashboard/tenants/hooks/useTenants.ts
import { useState, useEffect } from "react";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuthStore } from "@/stores/authStore";
import { Tenant } from "@/types";

export const initialCreateForm = {
  name: "",
  code: "",
  description: "",
  primaryColor: "#4f46e5",
  maxUsers: "100",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  website: "",
};

export const initialEditForm = {
  name: "",
  code: "",
  description: "",
  primaryColor: "#4f46e5",
  status: "",
  maxUsers: "100",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  website: "",
};

export function useTenants() {
  const {
    tenants,
    isLoading,
    error,
    fetchTenants,
    createTenant,
    updateTenant,
    refetchTenants,
    deleteTenant,
  } = useTenantStore();

  // A-76: listing, creating and deleting tenants are platform operations —
  // super admin only on the backend. Everyone else manages their own tenant
  // (read, edit, SSO, backups), so the list is scoped to it and the create and
  // delete controls are not offered.
  const user = useAuthStore((state) => state.user);
  const canManagePlatform =
    user?.role?.name === "SUPERADMIN" || user?.role?.name === "SUPER_ADMIN";
  const ownTenantId = canManagePlatform ? null : (user?.tenantId ?? null);

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [showSsoPanel, setShowSsoPanel] = useState(false);
  const [ssoConfigTenant, setSsoConfigTenant] = useState<Tenant | null>(null);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [createForm, setCreateForm] = useState({ ...initialCreateForm });
  const [editForm, setEditForm] = useState({ ...initialEditForm });
  const [createLogoFile, setCreateLogoFile] = useState<File | null>(null);
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoKeep, setEditLogoKeep] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");
  const [editLogoPreview, setEditLogoPreview] = useState("");

  useEffect(() => {
    // Wait for the principal: without it we cannot tell which list to ask for,
    // and guessing "all" is a guaranteed 403 for a tenant admin.
    if (!user) return;
    fetchTenants(currentPage, pageSize, searchTerm, ownTenantId);
  }, [fetchTenants, searchTerm, currentPage, pageSize, user, ownTenantId]);

  const handleDelete = async (id: string) => {
    try {
      await deleteTenant(id);
    } catch {
      // F-64: the store holds the backend's message in `error`, which the
      // page renders; the tenant stays in the list because it was not deleted.
    } finally {
      setShowDeleteConfirm(null);
    }
  };

  const handleDeleteRequest = (id: string) => setShowDeleteConfirm(id);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setIsSubmitting(true);
    try {
      await createTenant({
        name: createForm.name,
        code: createForm.code,
        description: createForm.description || undefined,
        primaryColor: createForm.primaryColor || undefined,
        maxUsers: parseInt(createForm.maxUsers, 10) || undefined,
        file: createLogoFile || undefined,
        email: createForm.email || undefined,
        phone: createForm.phone || undefined,
        address: createForm.address || undefined,
        city: createForm.city || undefined,
        state: createForm.state || undefined,
        zipCode: createForm.zipCode || undefined,
        country: createForm.country || undefined,
        website: createForm.website || undefined,
      });
      setShowCreateModal(false);
      setCreateForm({ ...initialCreateForm });
      setCreateLogoFile(null);
      setLogoPreview("");
      await refetchTenants();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create tenant",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setEditForm({
      name: tenant.name,
      code: tenant.code,
      description: tenant.description || "",
      primaryColor: tenant.primaryColor || "#4f46e5",
      status: tenant.status,
      maxUsers: tenant.maxUsers?.toString() || "100",
      email: tenant.email || "",
      phone: tenant.phone || "",
      address: tenant.address || "",
      city: tenant.city || "",
      state: tenant.state || "",
      zipCode: tenant.zipCode || "",
      country: tenant.country || "",
      website: tenant.website || "",
    });
    if (tenant.logoBaseUrl) {
      setEditLogoPreview(tenant.logoBaseUrl);
      setEditLogoKeep(true);
      setEditLogoFile(null);
    } else {
      // P7-08 / ADR-071 (amendment): `logoBaseUrl` is null exactly when the
      // backend will not serve the stored logo — none, the placeholder, or an
      // old absolute URL. Building a URL from the raw value here showed a
      // broken image; the empty preview is the fallback.
      setEditLogoPreview("");
      setEditLogoKeep(false);
      setEditLogoFile(null);
    }
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      await updateTenant({
        tenantId: editingTenant.id,
        name: editForm.name,
        code: editForm.code,
        description: editForm.description || undefined,
        primaryColor: editForm.primaryColor || undefined,
        status: editForm.status as "ACTIVE" | "INACTIVE" | "SUSPENDED",
        maxUsers: parseInt(editForm.maxUsers, 10) || undefined,
        file: editLogoFile || undefined,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
        address: editForm.address || undefined,
        city: editForm.city || undefined,
        state: editForm.state || undefined,
        zipCode: editForm.zipCode || undefined,
        country: editForm.country || undefined,
        website: editForm.website || undefined,
      });
      setShowEditModal(false);
      setEditingTenant(null);
      setEditLogoFile(null);
      setEditLogoKeep(false);
      setEditLogoPreview("");
      await refetchTenants();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Failed to update tenant",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSsoClick = (tenant: Tenant) => {
    setSsoConfigTenant(tenant);
    setShowSsoPanel(true);
  };

  return {
    canManagePlatform,
    tenants,
    isLoading,
    error,
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
    editingTenant,
    showSsoPanel,
    setShowSsoPanel,
    ssoConfigTenant,
    setSsoConfigTenant,
    formError,
    setFormError,
    isSubmitting,
    createForm,
    setCreateForm,
    editForm,
    setEditForm,
    createLogoFile,
    setCreateLogoFile,
    editLogoFile,
    setEditLogoFile,
    editLogoKeep,
    setEditLogoKeep,
    logoPreview,
    setLogoPreview,
    editLogoPreview,
    setEditLogoPreview,
    handleDelete,
    handleDeleteRequest,
    handleCreate,
    handleEdit,
    handleUpdate,
    handleSsoClick,
  };
}
