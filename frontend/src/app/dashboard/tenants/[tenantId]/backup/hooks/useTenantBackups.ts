import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  tenantBackupService,
  TenantBackup,
} from "@/api/services/tenantBackup.service";

export function useTenantBackups(tenantId?: string, tenantName?: string) {
  const router = useRouter();

  const [backups, setBackups] = useState<TenantBackup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Create backup modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    backupType: "FULL" as "FULL" | "PARTIAL" | "USER_ONLY",
    retentionDays: "90",
    tag: "",
  });

  // Restore/download actions
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
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
      setError(err instanceof Error ? err.message : "Failed to fetch backups");
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
    try {
      const result = await tenantBackupService.restore(tenantId, backupId);
      setSuccess(result.message || "Restore initiated successfully");
      fetchBackups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
    } finally {
      setActionLoading(null);
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
    handleCreateBackup,
    handleDeleteBackup,
    handleDownloadBackup,
    handleRestoreBackup,
  };
}

export default useTenantBackups;
