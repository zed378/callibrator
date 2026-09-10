// src/app/dashboard/roles/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, Card, CardContent, TableSkeleton } from "@/components/ui";
import { Pagination } from "@/components/ui/Table";
import { Plus, Shield } from "lucide-react";
import {
  RolesStats,
  RolesSearch,
  RolesTable,
  RolesModal,
  RolesDeleteConfirm,
  RolesHeader,
} from "./components";
import { useRoles } from "./hooks/useRoles";

export default function RolesPage() {
  const {
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
  } = useRoles();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <RolesHeader onAddRole={() => setShowCreateModal(true)} />

        <RolesStats
          totalRoles={totalRoles}
          activeRoles={activeRoles}
          inactiveRoles={inactiveRoles}
        />

        <RolesSearch searchTerm={searchTerm} onChange={setSearchTerm} />

        {error && (
          <Alert variant="error" title="Error">
            {error}
          </Alert>
        )}

        {isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : roles?.data && roles.data.length > 0 ? (
          <Card className="overflow-hidden">
            <RolesTable
              roles={roles.data}
              onEdit={handleEdit}
              onDelete={(id) => setShowDeleteConfirm(id)}
            />
              <div className="px-6 py-4 border-t border-border">
              <Pagination
                currentPage={currentPage}
                totalPages={roles.meta?.totalPages || 1}
                totalItems={roles.meta?.total || roles?.data?.length || 0}
                pageSize={pageSize}
                onPageChange={(page) => setCurrentPage(page)}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                pageSizes={[5, 10, 25, 50]}
              />
            </div>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No roles found
              </h3>
              <p className="text-muted-foreground mb-4">
                Get started by creating a new role.
              </p>
              <Button
                variant="primary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setShowCreateModal(true)}
              >
                Create Role
              </Button>
            </CardContent>
          </Card>
        )}

        <RolesModal
          type="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          form={createForm}
          formError={formError}
          isSubmitting={isSubmitting}
          onSubmit={handleCreate}
          onChange={setCreateForm}
        />
        <RolesModal
          type="edit"
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          form={editForm}
          formError={formError}
          isSubmitting={isSubmitting}
          onSubmit={handleUpdate}
          onChange={setEditForm}
        />
        <RolesDeleteConfirm
          isOpen={!!showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(null)}
          onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
          isLoading={isLoading}
        />
      </div>
    </DashboardLayout>
  );
}
