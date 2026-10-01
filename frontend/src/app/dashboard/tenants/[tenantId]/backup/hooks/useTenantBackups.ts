import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  tenantBackupService,
  TenantBackup,
  RestoreOutcome,
} from "@/api/services/tenantBackup.service";

/**
 * A destructive action waiting for confirmation. Restore overwrites the
 * tenant's data from the archive and cannot be undone; delete removes the
 * archive for good. Neither runs on the first click (audit §4.4, severity 4).
 */
export interface PendingBackupAction {
  kind: "restore" | "delete";
  backup: TenantBackup;
}

/** The "create backup" form (BackupCreateModal). */
export interface BackupCreateForm {
  name: string;
  description: string;
  backupType: "FULL" | "PARTIAL" | "USER_ONLY";
  retentionDays: string;
  tag: string;
}

export function useTenantBackups(tenantId?: string, tenantName?: string) {
  const router = useRouter();

  const [backups, setBackups] = useState<TenantBackup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  // F-19: whether the LIST failed to load — the page then shows no empty state
  // ("No backups found" beside the error said the tenant had none). The ref
  // holds that failure's message, so the next list read clears it and only it
  // (a mutation's refusal is not a list error and is left alone).
  const [listFailed, setListFailed] = useState(false);
  const listErrorRef = useRef<string | null>(null);
  const [success, setSuccess] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Create backup modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<BackupCreateForm>({
    name: "",
    description: "",
    backupType: "FULL",
    retentionDays: "90",
    tag: "",
  });

  // Restore/download actions
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingBackupAction | null>(null);

  // The outcome of the last restore, including the accounts it did NOT
  // re-create (A-156). Null until a restore succeeds.
  const [restoreOutcome, setRestoreOutcome] = useState<RestoreOutcome | null>(
    null,
  );

  const fetchBackups = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    const stale = listErrorRef.current;
    if (stale !== null) {
      setError((current) => (current === stale ? "" : current));
      listErrorRef.current = null;
    }
    setListFailed(false);
    try {
      const response = await tenantBackupService.getAll(
        tenantId,
        currentPage,
        pageSize,
      );
      setBackups(response.data);
      setTotalPages(response.meta.totalPages);
      setTotalItems(response.meta.total);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch backups";
      listErrorRef.current = message;
      setListFailed(true);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, currentPage, pageSize]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBackups();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchBackups]);

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setIsCreating(true);
    setError("");
    setSuccess("");
    try {
      await tenantBackupService.create(tenantId, {
        name: createForm.name,
        description: createForm.description || undefined,
        backupType: createForm.backupType,
        retentionDays: parseInt(createForm.retentionDays, 10),
        tag: createForm.tag || undefined,
      });
      setSuccess("Backup created successfully");
      setShowCreateModal(false);
      setCreateForm({
        name: "",
        description: "",
        backupType: "FULL",
        retentionDays: "90",
        tag: "",
      });
      fetchBackups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create backup");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    if (!tenantId) return;
    setActionLoading(backupId);
    setError("");
    try {
      await tenantBackupService.delete(tenantId, backupId);
      setSuccess("Backup deleted successfully");
      fetchBackups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete backup");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadBackup = async (backupId: string) => {
    if (!tenantId) return;
    setActionLoading(backupId);
    setError("");
    try {
      // The endpoint streams a zip. Plain download() only fetched the blob and
      // discarded it, so the old "Download started" message was a lie —
      // downloadToDisk actually saves the file.
      const backup = backups.find((b) => b.id === backupId);
      await tenantBackupService.downloadToDisk(
        tenantId,
        backupId,
        `${backup?.name ?? `backup-${backupId}`}.zip`,
      );
      setSuccess("Download started");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to download backup",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!tenantId) return;
    setActionLoading(backupId);
    setError("");
    setRestoreOutcome(null);
    try {
      const result = await tenantBackupService.restore(tenantId, backupId);
      setSuccess(result.message || "Restore initiated successfully");
      setRestoreOutcome(result.outcome);
      fetchBackups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
    } finally {
      setActionLoading(null);
    }
  };

  /** Ask before restoring: the page shows a confirmation naming the backup. */
  const requestRestoreBackup = (backupId: string) => {
    const backup = backups.find((b) => b.id === backupId);
    if (backup) setPendingAction({ kind: "restore", backup });
  };

  /** Ask before deleting. */
  const requestDeleteBackup = (backupId: string) => {
    const backup = backups.find((b) => b.id === backupId);
    if (backup) setPendingAction({ kind: "delete", backup });
  };

  const cancelPendingAction = () => setPendingAction(null);

  /** Run the confirmed action. */
  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const { kind, backup } = pendingAction;
    setPendingAction(null);
    if (kind === "restore") {
      await handleRestoreBackup(backup.id);
    } else {
      await handleDeleteBackup(backup.id);
    }
  };

  return {
    tenantId,
    tenantName,
    router,
    backups,
    isLoading,
    isCreating,
    error,
    setError,
    listFailed,
    fetchBackups,
    success,
    setSuccess,
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
    handleDeleteBackup,
    handleDownloadBackup,
    handleRestoreBackup,
    pendingAction,
    requestRestoreBackup,
    requestDeleteBackup,
    cancelPendingAction,
    confirmPendingAction,
  };
}

export default useTenantBackups;
