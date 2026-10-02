import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

/**
 * Background batch jobs.
 *
 * The tenant/owner come from the caller's JWT.
 * Backend: src/routes/api/batchJobs.route.ts (mounted /api/v1/jobs)
 *   GET  /        ?page&limit
 *   GET  /:id
 *   POST /test    create a demo job
 *
 * That is the whole API. There is no general create, no cancel, no delete and
 * no /stats — note that a request to /jobs/stats would fall through to
 * GET /:id with id="stats" and 404 as "Job not found".
 *
 * GET / answers the house envelope (A-342): the rows in `data`, the
 * pagination `{ total, page, limit, totalPages }` in a top-level `meta`.
 */

// ---------- Types ----------
// P9-25 (ADR-103 item 11): from the contract (backend/src/routes/api/batchJobs.openapi.ts).

type ApiBatchJob = components["schemas"]["BatchJob"];

/** Model enum — uppercase. */
export type JobStatus = ApiBatchJob["status"];

/**
 * Free-form string on the model, not an enum. "EXPORT_CSV" is the server
 * default for the test route.
 */
export type JobType = ApiBatchJob["type"];

/** A job as the contract publishes it (A-354: no `failedItems` / `errorMessage` — the row has neither). */
export type BatchJob = ApiBatchJob;

/** Shape the backend actually returns for GET /jobs. */
export interface BatchJobPage {
  rows: BatchJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListParams {
  page?: number;
  limit?: number;
}

/** Body read by POST /jobs/test — only these two fields. */
export type TestJobInput = JsonBody<Op<"/api/v1/jobs/test", "post">>;

// ---------- Service ----------

export const batchJobService = {
  /** GET /jobs — rows in `data`, pagination in the top-level `meta` (A-342). */
  getAll: async (params: ListParams = {}): Promise<BatchJobPage> => {
    const response = await typedApi.GET("/api/v1/jobs", { params: { query: params } }).then(unwrap);
    const meta = response.meta;
    return {
      rows: Array.isArray(response.data) ? response.data : [],
      total: meta?.total ?? 0,
      page: meta?.page ?? params.page ?? 1,
      limit: meta?.limit ?? params.limit ?? 10,
      totalPages: meta?.totalPages ?? 1,
    };
  },

  /** GET /jobs/:id */
  getById: async (id: string): Promise<BatchJob> =>
    (await typedApi.GET("/api/v1/jobs/{id}", { params: { path: { id } } }).then(unwrap)).data,

  /**
   * POST /jobs/test — enqueues a demo job. The backend reads only
   * { type, totalItems }; anything else is ignored.
   */
  createTestJob: async (input: TestJobInput = {}): Promise<BatchJob> =>
    (await typedApi.POST("/api/v1/jobs/test", { body: input }).then(unwrap)).data,
};

export default batchJobService;
