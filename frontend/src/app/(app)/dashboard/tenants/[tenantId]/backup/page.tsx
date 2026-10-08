"use client";

import React, { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, Card, CardContent, ConfirmDialog } from "@/components/ui";
import { Plus, Loader2, FileArchive } from "lucide-react";
import { Pagination } from "@/components/ui/Table";
import { useTenantBackups } from "./hooks/useTenantBackups";
import BackupCreateModal from "./components/BackupCreateModal";
import BackupList from "./components/BackupList";
import RestoreOutcomePanel from "./components/RestoreOutcomePanel";
import { backupLabel } from "@/api/services/tenantBackup.service";

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
    listFailed,
    fetchBackups,
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
    restoreOutcome,
    setRestoreOutcome,
    handleCreateBackup,
    handleDownloadBackup,
    pendingAction,
    requestRestoreBackup,
    requestDeleteBackup,
    cancelPendingAction,
    confirmPendingAction,
  } = useTenantBackups(tenantId, tenantName);
  const tenantLabel = tenantName || tenantId;

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
                {/* A-362: the API's lower-case status. */}
                {backups.filter((b) => b.status === "completed").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Failed</p>
              <p className="text-2xl font-bold text-destructive mt-1">
                {backups.filter((b) => b.status === "failed").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold text-warning mt-1">
                {backups.filter((b) => b.status === "in_progress").length}
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
        {restoreOutcome && (
          <RestoreOutcomePanel
            outcome={restoreOutcome}
            onClose={() => setRestoreOutcome(null)}
          />
        )}

        {/* Backups List */}
        {isLoading ? (
          <Card>
            <div className="p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 text-info animate-spin" />
              <p className="text-muted-foreground mt-4">Loading backups...</p>
            </div>
          </Card>
        ) : listFailed ? (
          // F-19: a failed read is not "no backups" — the error above says why.
          <Card>
            <div className="p-8 text-center">
              <p className="text-muted-foreground">
                Backups could not be loaded.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => void fetchBackups()}
              >
                Try again
              </Button>
            </div>
          </Card>
        ) : backups.length > 0 ? (
          <>
            <BackupList
              backups={backups}
              actionLoading={actionLoading}
              handleDownloadBackup={handleDownloadBackup}
              handleRestoreBackup={requestRestoreBackup}
              handleDeleteBackup={requestDeleteBackup}
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

      {/* Destructive backup actions ask first. A restore overwrites the tenant's
          data and cannot be undone, so the backup's name must be typed. */}
      <ConfirmDialog
        isOpen={pendingAction?.kind === "restore"}
        title={`Restore backup "${pendingAction ? backupLabel(pendingAction.backup) : ""}"?`}
        description={
          <>
            This replaces the current data of tenant {tenantLabel} with the
            contents of this backup, created{" "}
            {pendingAction ? new Date(pendingAction.backup.createdAt).toLocaleString() : ""}.
            Changes made since then are lost. This cannot be undone — create a
            fresh backup first if you may need today&apos;s data.
          </>
        }
        confirmLabel="Restore backup"
        // A-363: a backup taken before names were stored (NULL) is confirmed by its id.
        confirmPhrase={
          pendingAction?.kind === "restore" ? (pendingAction.backup.name?.trim() || pendingAction.backup.id) : undefined
        }
        isLoading={actionLoading !== null}
        onConfirm={() => void confirmPendingAction()}
        onCancel={cancelPendingAction}
      />
      <ConfirmDialog
        isOpen={pendingAction?.kind === "delete"}
        title={`Delete backup "${pendingAction ? backupLabel(pendingAction.backup) : ""}"?`}
        description="The archive is removed permanently and can no longer be downloaded or restored."
        confirmLabel="Delete backup"
        isLoading={actionLoading !== null}
        onConfirm={() => void confirmPendingAction()}
        onCancel={cancelPendingAction}
      />

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
