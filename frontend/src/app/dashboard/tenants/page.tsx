// src/app/dashboard/tenants/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, Card, CardSkeleton } from "@/components/ui";
import { Plus, Building2 } from "lucide-react";
import { Pagination } from "@/components/ui/Table";
import { TenantSearchInput } from "./components/TenantSearchInput";
import { TenantStatsCards } from "./components/TenantStatsCards";
import { TenantCard } from "./components/TenantCard";
import { CreateTenantModal } from "./components/CreateTenantModal";
import { EditTenantModal } from "./components/EditTenantModal";
import { SsoSettingsPanel } from "./components/SsoSettingsPanel";
import { DeleteTenantModal } from "./components/DeleteTenantModal";
import { useTenants } from "./hooks/useTenants";

export default function TenantsPage() {
  const {
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
  } = useTenants();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary" />
              Tenants Management
            </h1>
            <p className="text-muted-foreground mt-1">Configure and manage multitenant workspace environments</p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setFormError("");
              setShowCreateModal(true);
            }}
          >
            Create Tenant
          </Button>
        </div>

        <TenantStatsCards total={tenants?.meta?.total || 0} data={tenants?.data || []} />
        <TenantSearchInput value={searchTerm} onChange={setSearchTerm} />

        {error && <Alert variant="error">{error}</Alert>}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : tenants?.data && tenants.data.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {tenants.data
                .filter(
                  (t) =>
                    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    t.code.toLowerCase().includes(searchTerm.toLowerCase()),
                )
                .map((tenant) => (
                  <TenantCard
                    key={tenant.id}
                    tenant={tenant}
                    onEdit={handleEdit}
                    onSsoConfig={handleSsoClick}
                    onDelete={handleDeleteRequest}
                  />
                ))}
            </div>
            <div className="mt-6 w-full rounded-xl border border-border overflow-hidden">
              <Pagination
                currentPage={currentPage}
                totalPages={tenants.meta?.totalPages || 1}
                totalItems={tenants.meta?.total || 0}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setCurrentPage(1);
                }}
                pageSizes={[5, 10, 20]}
              />
            </div>
          </>
        ) : (
          <Card>
            <div className="p-12 text-center">
              <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No tenants found</h3>
              <p className="text-muted-foreground mb-4">Get started by creating your first tenant workspace.</p>
              <Button
                variant="primary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setShowCreateModal(true)}
              >
                Create Tenant
              </Button>
            </div>
          </Card>
        )}
      </div>

      <CreateTenantModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        form={createForm}
        onChange={setCreateForm}
        onSubmit={handleCreate}
        error={formError}
        isSubmitting={isSubmitting}
        logoFile={createLogoFile}
        setLogoFile={setCreateLogoFile}
        logoPreview={logoPreview}
        setLogoPreview={setLogoPreview}
      />

      <EditTenantModal
        isOpen={showEditModal}
        tenant={editingTenant}
        onClose={() => setShowEditModal(false)}
        form={editForm}
        onChange={setEditForm}
        onSubmit={handleUpdate}
        error={formError}
        isSubmitting={isSubmitting}
        logoFile={editLogoFile}
        setLogoFile={setEditLogoFile}
        logoPreview={editLogoPreview}
        setLogoPreview={setEditLogoPreview}
        logoKeep={editLogoKeep}
        setLogoKeep={setEditLogoKeep}
      />
      {showSsoPanel && ssoConfigTenant && (
        <div className="mt-8 border-t border-border pt-8">
          <SsoSettingsPanel
            tenant={ssoConfigTenant}
            onClose={() => {
              setShowSsoPanel(false);
              setSsoConfigTenant(null);
            }}
          />
        </div>
      )}
      <DeleteTenantModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
      />
    </DashboardLayout>
  );
}
