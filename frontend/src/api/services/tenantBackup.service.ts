import { api } from "../client";

/**
 * Tenant backups.
 *
 * Backend: src/routes/api/tenantBackup.route.js (mounted /api/v1/tenants)
 *   POST   /:tenantId/backups
 *   GET    /:tenantId/backups              ?page&limit&status
 *   GET    /:tenantId/backups/stats
 *   GET    /:tenantId/backups/:backupId
 *   GET    /:tenantId/backups/:backupId/download   (streams a zip)
 *   POST   /:tenantId/backups/:backupId/restore
 *   DELETE /:tenantId/backups/:backupId
 *
 * The list endpoint sends `data` = rows array with `meta` as a TOP-LEVEL
 * sibling — there is no data.rows / data.meta.
 */

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

interface BackendListResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T[];
  meta?: PageMeta;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TenantBackup {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  backupType: "FULL" | "PARTIAL" | "USER_ONLY";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "DELETING";
  fileSize?: number;
  filePath?: string;
  retentionDays?: number;
  tag?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Field names as the backend actually reports them. */
export interface BackupStats {
  totalBackups: number;
  completedBackups: number;
  failedBackups: number;
  /** Bytes, summed across completed backups. */
  totalSize: number;
  latestBackup?: TenantBackup | null;
  hasValidBackups?: boolean;
}

export interface BackupCreateInput {
  /** Required — the backend 400s without it. */
  name: string;
  description?: string;
  backupType?: "FULL" | "PARTIAL" | "USER_ONLY";
  retentionDays?: number;
  tag?: string;
}

export const tenantBackupService = {
  /** POST /:tenantId/backups — `name` is required. */
  create: async (
    tenantId: string,
    data: BackupCreateInput,
  ): Promise<TenantBackup> => {
    const response = await api.post<BackendResponse<TenantBackup>>(
      `/api/v1/tenants/${tenantId}/backups`,
      data,
    );
    return response.data;
  },

  /** GET /:tenantId/backups — rows in `data`, pagination in top-level `meta`. */
  getAll: async (
    tenantId: string,
    page = 1,
    limit = 20,
    status?: string,
  ): Promise<{ data: TenantBackup[]; meta: PageMeta }> => {
    const response = await api.get<BackendListResponse<TenantBackup>>(
      `/api/v1/tenants/${tenantId}/backups`,
      { params: { page, limit, status } },
    );
    const rows = response.data ?? [];
    return {
      data: rows,
      meta:
        response.meta ?? {
          total: rows.length,
          page,
          limit,
          totalPages: 1,
        },
    };
  },

  /** GET /:tenantId/backups/:backupId */
  getById: async (
    tenantId: string,
    backupId: string,
  ): Promise<TenantBackup> => {
    const response = await api.get<BackendResponse<TenantBackup>>(
      `/api/v1/tenants/${tenantId}/backups/${backupId}`,
    );
    return response.data;
  },

  /**
   * GET /:tenantId/backups/:backupId/download
   *
   * Streams a zip with Content-Disposition: attachment — NOT an envelope. It
   * must be read as a blob, otherwise axios parses it as JSON and nothing is
   * saved. Returns the Blob so the caller can drive the download.
   */
  download: async (tenantId: string, backupId: string): Promise<Blob> =>
    api.get<Blob>(`/api/v1/tenants/${tenantId}/backups/${backupId}/download`, {
      responseType: "blob",
    }),

  /**
   * Download and save the backup zip via a temporary object URL.
   * Browser-only.
   */
  downloadToDisk: async (
    tenantId: string,
    backupId: string,
    filename = `backup-${backupId}.zip`,
  ): Promise<void> => {
    const blob = await tenantBackupService.download(tenantId, backupId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * POST /:tenantId/backups/:backupId/restore
   * The backend reads a single `mergeData` flag: merge (keep existing rows)
   * vs overwrite.
   */
  restore: async (
    tenantId: string,
    backupId: string,
    options?: { overwriteExisting?: boolean },
  ): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<BackendResponse<unknown>>(
      `/api/v1/tenants/${tenantId}/backups/${backupId}/restore`,
      { mergeData: options?.overwriteExisting === false },
    );
    return { success: response.success, message: response.message };
  },

  /** DELETE /:tenantId/backups/:backupId */
  delete: async (tenantId: string, backupId: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(
      `/api/v1/tenants/${tenantId}/backups/${backupId}`,
    );
  },

  /**
   * GET /:tenantId/backups/stats
   * Registered before /:backupId, so "stats" is not treated as an id.
   */
  getStats: async (tenantId: string): Promise<BackupStats> => {
    const response = await api.get<BackendResponse<BackupStats>>(
      `/api/v1/tenants/${tenantId}/backups/stats`,
    );
    return response.data;
  },
};

export default tenantBackupService;
