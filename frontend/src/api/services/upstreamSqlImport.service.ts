import { api } from "../client";
import { typedApi, unwrap, type DataOf, type Op, type components } from "../typed";
import { UPLOAD_CLIENT_TIMEOUT_MS } from "@/constants";

/**
 * P24-06 — the super admin's SQL-dump import, against
 * backend/src/routes/api/admin.route.ts (`/api/v1/admin/upstream-sql-imports`,
 * super admin only) and backend/src/services/upstreamSqlImport.service.ts. The
 * dump is uploaded, PARSED (never executed) by a background job into staging,
 * and the uploader notified. Rows in `data`, pagination in a top-level `meta`.
 *
 * On the GENERATED client: every type is the contract's
 * (backend/src/routes/api/admin.openapi.ts). The upload goes through the axios
 * client for its progress events, with the upload's own long timeout.
 */

export type SqlImportRun = components["schemas"]["UpstreamSqlImportRun"];
export type SqlImportStatus = SqlImportRun["status"];
export type SqlImportTable = SqlImportRun["tables"][number];
export type SqlImportSettings = DataOf<Op<"/api/v1/admin/upstream-sql-imports/settings", "get">>;
export type SqlImportDataClass = SqlImportRun["dataClass"];

/** The statuses a run can still move from (the page polls while one is shown). */
export const ACTIVE_SQL_IMPORT_STATUSES: readonly SqlImportStatus[] = ["uploaded", "scanning", "parsing"];

export interface SqlImportPage {
  rows: SqlImportRun[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const byId = (id: string) => ({ params: { path: { id } } });

export const upstreamSqlImportService = {
  settings: async (): Promise<SqlImportSettings> =>
    (await typedApi.GET("/api/v1/admin/upstream-sql-imports/settings").then(unwrap)).data,

  list: async (page = 1, limit = 20): Promise<SqlImportPage> => {
    const res = await typedApi.GET("/api/v1/admin/upstream-sql-imports", { params: { query: { page, limit } } }).then(unwrap);
    return { rows: res.data ?? [], meta: res.meta };
  },

  get: async (id: string): Promise<SqlImportRun> =>
    (await typedApi.GET("/api/v1/admin/upstream-sql-imports/{id}", byId(id)).then(unwrap)).data,

  /** Multipart: `file` and the uploader's declaration. `onProgress` gets 0 … 1. */
  upload: async (file: File, dataClass: SqlImportDataClass, onProgress?: (fraction: number) => void): Promise<SqlImportRun> => {
    const form = new FormData();
    form.append("dataClass", dataClass);
    form.append("file", file);
    const answer = await api.post<{ data: SqlImportRun }>("/api/v1/admin/upstream-sql-imports", form, {
      timeout: UPLOAD_CLIENT_TIMEOUT_MS,
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      },
    });
    return answer.data;
  },

  cancel: async (id: string): Promise<SqlImportRun> =>
    (
      await typedApi
        // The route reads no body; an empty JSON object, as the other admin actions send.
        .POST("/api/v1/admin/upstream-sql-imports/{id}/cancel", { ...byId(id), body: {} as never })
        .then(unwrap)
    ).data,

  retry: async (id: string): Promise<SqlImportRun> =>
    (await typedApi.POST("/api/v1/admin/upstream-sql-imports/{id}/retry", { ...byId(id), body: {} as never }).then(unwrap)).data,
};
