import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * Tenant backups.
 *
 * Backend: src/routes/api/tenantBackup.route.ts (mounted /api/v1/tenants)
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
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/tenantBackup.openapi.ts). The exported
 * names are unchanged. The zip download stays on `api` (blob).
 */

type TB = "/api/v1/tenants/{tenantId}/backups";

export type PageMeta = components["schemas"]["PaginationMeta"];

/** A backup row as the API answers it (the model's lower-case status). */
export type ApiTenantBackup = components["schemas"]["TenantBackup"];

/** The named fields of an open (`additionalProperties`) schema: `Omit` over its index signature keeps nothing. */
type Known<T> = { [K in keyof T as string extends K ? never : K]: T[K] };

/**
 * A backup as the API answers it, and as the backup page reads it.
 *  - A-362: `status` is the model's lower-case ENUM (`pending`, `in_progress`,
 *    `completed`, `failed`, `deleted`). The page compared upper-case values,
 *    which no row carries, so it never offered Download or Restore.
 *  - A-363: `name` and `description` are stored since migration 0108; a
 *    backup taken before it has neither (NULL). A failure's text is
 *    `errorMessage`; there is no `completedAt` or `error` (the row's last
 *    change is `updatedAt`).
 */
export type TenantBackup = Known<ApiTenantBackup>;

/** A backup's lifecycle value, as the API answers it. */
export type TenantBackupStatus = TenantBackup["status"];

/** What a backup is called on the page: its name, or a stand-in for one taken before names were stored (A-363). */
export const backupLabel = (backup: Pick<TenantBackup, "name">): string => {
  const name = backup.name?.trim();
  return name ? name : "Untitled backup";
};

const asBackup = (row: ApiTenantBackup): TenantBackup => row;

/** Field names as the backend actually reports them (`totalSize` in bytes, completed backups). */
export type BackupStats = Omit<DataOf<Op<`${TB}/stats`, "get">>, "latestBackup"> & {
  latestBackup?: TenantBackup | null;
};

/** `name` is required by the API (and stored since migration 0108, A-363). */
export type BackupCreateInput = JsonBody<Op<TB, "post">>;

/**
 * `data` of POST /:backupId/restore: the per-account outcome, including
 * `notRestored` — the archived accounts a restore never re-creates (ADR-051
 * Q-09, A-156). `absent`: no such account in the tenant (it may be
 * re-invited); `erased`: erased under GDPR (it must NOT be re-invited).
 */
export type RestoreOutcome = DataOf<Op<`${TB}/{backupId}/restore`, "post">>;
export type NotRestoredEntry = RestoreOutcome["notRestored"][number];
export type NotRestoredReason = NotRestoredEntry["reason"];

export interface RestoreResult {
  success: boolean;
  message: string;
  /** Null only if the backend sent no data (never on a 200 today). */
  outcome: RestoreOutcome | null;
}

const backup = (tenantId: string, backupId: string) => ({ params: { path: { tenantId, backupId } } });

export const tenantBackupService = {
  /** POST /:tenantId/backups — `name` is required. */
  create: async (
    tenantId: string,
    data: BackupCreateInput,
  ): Promise<TenantBackup> => {
    const response = await typedApi
      .POST("/api/v1/tenants/{tenantId}/backups", { params: { path: { tenantId } }, body: data })
      .then(unwrap);
    return asBackup(response.data);
  },

  /** GET /:tenantId/backups — rows in `data`, pagination in top-level `meta`. */
  getAll: async (
    tenantId: string,
    page = 1,
    limit = 20,
    status?: string,
  ): Promise<{ data: TenantBackup[]; meta: PageMeta }> => {
    const response = await typedApi
      .GET("/api/v1/tenants/{tenantId}/backups", {
        params: {
          path: { tenantId },
          // As built: page/limit as numbers (the same text on the wire as the
          // published strings), the status filter as the page gives it.
          query: { page, limit, status } as unknown as QueryOf<Op<TB, "get">>,
        },
      })
      .then(unwrap);
    // Defensive, as built: a body without rows or `meta` still renders.
    const rows = (response.data ?? []).map(asBackup);
    return {
      data: rows,
      meta:
        (response.meta as PageMeta | undefined) ?? {
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
    const response = await typedApi
      .GET("/api/v1/tenants/{tenantId}/backups/{backupId}", backup(tenantId, backupId))
      .then(unwrap);
    return asBackup(response.data);
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
   *
   * Returns the per-account outcome too, including `notRestored` — the
   * archived accounts the restore did not re-create (A-156). Dropping it left
   * the operator with "Backup restored successfully" and no way to see who is
   * missing.
   */
  restore: async (
    tenantId: string,
    backupId: string,
    options?: { overwriteExisting?: boolean },
  ): Promise<RestoreResult> => {
    const response = await typedApi
      .POST("/api/v1/tenants/{tenantId}/backups/{backupId}/restore", {
        ...backup(tenantId, backupId),
        body: { mergeData: options?.overwriteExisting === false },
      })
      .then(unwrap);
    // Defensive, as built: a body without `data` (or without notRestored) still reads.
    const outcome = response.data ?? null;
    return {
      success: response.success,
      message: response.message,
      outcome: outcome
        ? { ...outcome, notRestored: outcome.notRestored ?? [] }
        : null,
    };
  },

  /** DELETE /:tenantId/backups/:backupId */
  delete: async (tenantId: string, backupId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/tenants/{tenantId}/backups/{backupId}", backup(tenantId, backupId));
  },

  /**
   * GET /:tenantId/backups/stats
   * Registered before /:backupId, so "stats" is not treated as an id.
   */
  getStats: async (tenantId: string): Promise<BackupStats> => {
    const { latestBackup, ...stats } = (
      await typedApi.GET("/api/v1/tenants/{tenantId}/backups/stats", { params: { path: { tenantId } } }).then(unwrap)
    ).data;
    return { ...stats, latestBackup: latestBackup ? asBackup(latestBackup) : latestBackup };
  },
};

export default tenantBackupService;
