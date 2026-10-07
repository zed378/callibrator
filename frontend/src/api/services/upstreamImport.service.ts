import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * The rsync image import (super admin only), against
 * backend/src/routes/api/upstreamFileImports.route.ts (`/api/v1/admin/upstream-file-imports`)
 * and its contract upstreamFileImports.openapi.ts. Rows in `data`, pagination in a top-level
 * `meta`. No answer carries the password or the private key: they are sent, never read back.
 */

export type UpstreamImport = components["schemas"]["UpstreamFileImport"];
export type UpstreamImportStatus = UpstreamImport["status"];
export type ConnectionCheck = components["schemas"]["UpstreamConnectionCheck"];
export type CheckInput = JsonBody<Op<"/api/v1/admin/upstream-file-imports/check-connection", "post">>;
export type StartInput = JsonBody<Op<"/api/v1/admin/upstream-file-imports", "post">>;
export type ImportConfig = DataOf<Op<"/api/v1/admin/upstream-file-imports/config", "get">>;

/** The statuses an import can still leave (it can be cancelled; the page polls). */
export const LIVE_STATUSES: readonly UpstreamImportStatus[] = ["pending", "transferring", "ingesting"];

export interface UpstreamImportPage {
  rows: UpstreamImport[];
  total: number;
}

const byId = (id: string) => ({ params: { path: { id } } });

export const upstreamImportService = {
  config: async (): Promise<ImportConfig> =>
    (await typedApi.GET("/api/v1/admin/upstream-file-imports/config").then(unwrap)).data,

  check: async (input: CheckInput): Promise<ConnectionCheck> =>
    (await typedApi.POST("/api/v1/admin/upstream-file-imports/check-connection", { body: input }).then(unwrap)).data,

  start: async (input: StartInput): Promise<UpstreamImport> =>
    (await typedApi.POST("/api/v1/admin/upstream-file-imports", { body: input }).then(unwrap)).data,

  list: async (page = 1, limit = 20): Promise<UpstreamImportPage> => {
    const res = await typedApi
      .GET("/api/v1/admin/upstream-file-imports", { params: { query: { page, limit } } })
      .then(unwrap);
    return { rows: res.data ?? [], total: res.meta?.total ?? 0 };
  },

  get: async (id: string): Promise<UpstreamImport> =>
    (await typedApi.GET("/api/v1/admin/upstream-file-imports/{id}", byId(id)).then(unwrap)).data,

  cancel: async (id: string): Promise<UpstreamImport> =>
    (
      await typedApi
        .POST("/api/v1/admin/upstream-file-imports/{id}/cancel", { ...byId(id), body: {} as never })
        .then(unwrap)
    ).data,
};
