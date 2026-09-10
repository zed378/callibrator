"use client";

import React, { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, Card, CardContent } from "@/components/ui";
import { Plus, Loader2, FileArchive } from "lucide-react";
import { Pagination } from "@/components/ui/Table";
import { useTenantBackups } from "./hooks/useTenantBackups";
import BackupCreateModal from "./components/BackupCreateModal";
import BackupList from "./components/BackupList";

function TenantBackupContent() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params?.tenantId as string;
  const tenantName = params?.tenantName as string;

  const {
    router: hookRouter,
    backups,
    isLoading,
    isCreating,
    error,
    success,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    showCreateModal,
    setShowCreateModal,
    createForm,
    setCreateForm,
    actionLoading,
    handleCreateBackup,
    handleDeleteBackup,
    handleDownloadBackup,
    handleRestoreBackup,
  } = useTenantBackups(tenantId, tenantName);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <button
              onClick={() => hookRouter.push(`/dashboard/tenants`)}
              className="text-sm text-info hover:underline mb-2"
            >
              ← Back to Tenants
            </button>
            <h1 className="text-2xl font-bold text-foreground">
              Backup: {tenantName || tenantId}
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage backups and restores for this tenant
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            Create Backup
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total Backups</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {totalItems}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-success mt-1">
                {backups.filter((b) => b.status === "COMPLETED").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Failed</p>
              <p className="text-2xl font-bold text-destructive mt-1">
                {backups.filter((b) => b.status === "FAILED").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold text-warning mt-1">
                {backups.filter((b) => b.status === "IN_PROGRESS").length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Alerts */}
        {error && (
          <Alert variant="error" title="Error">
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" title="Success">
            {success}
          </Alert>
        )}

        {/* Backups List */}
        {isLoading ? (
          <Card>
            <div className="p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 text-info animate-spin" />
              <p className="text-muted-foreground mt-4">Loading backups...</p>
            </div>
          </Card>
        ) : backups.length > 0 ? (
          <>
            <BackupList
              backups={backups}
              actionLoading={actionLoading}
              handleDownloadBackup={handleDownloadBackup}
              handleRestoreBackup={handleRestoreBackup}
              handleDeleteBackup={handleDeleteBackup}
            />

            <div className="mt-6">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageChange={(page) => setCurrentPage(page)}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                pageSizes={[10, 25, 50, 100]}
              />
            </div>
          </>
        ) : (
          <Card>
            <div className="p-8 text-center">
              <FileArchive className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground mt-4">
                No backups found for this tenant
              </p>
              <Button
                variant="primary"
                className="mt-4"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setShowCreateModal(true)}
              >
                Create First Backup
              </Button>
            </div>
          </Card>
        )}
      </div>

      <BackupCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateBackup}
        form={createForm}
        setForm={setCreateForm}
        isCreating={isCreating}
      />
    </DashboardLayout>
  );
}

export default function TenantBackupPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TenantBackupContent />
    </Suspense>
  );
}
