import { api } from "../client";

/**
 * Background batch jobs.
 *
 * The tenant/owner come from the caller's JWT.
 * Backend: src/routes/api/batchJobs.route.js (mounted /api/v1/jobs)
 *   GET  /        ?page&limit
 *   GET  /:id
 *   POST /test    create a demo job
 *
 * That is the whole API. There is no general create, no cancel, no delete and
 * no /stats — note that a request to /jobs/stats would fall through to
 * GET /:id with id="stats" and 404 as "Job not found".
 *
 * GET / returns data as `{ total, page, limit, totalPages, jobs }` — rows are
 * under `jobs`, not `data.rows`, and there is no top-level `meta`.
 */

const BASE = "/api/v1/jobs";

// ---------- Types ----------

/** Model enum — uppercase. */
export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

/**
 * Free-form string on the model, not an enum. "EXPORT_CSV" is the server
 * default for the test route.
 */
export type JobType = string;

export interface BatchJob {
  id: string;
  type: JobType;
  status: JobStatus;
  totalItems?: number;
  processedItems?: number;
  failedItems?: number;
  resultUrl?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

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
export interface TestJobInput {
  /** Defaults to "EXPORT_CSV" server-side. */
  type?: JobType;
  /** Defaults to 10 server-side. */
  totalItems?: number;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

interface RawJobList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  jobs: BatchJob[];
}

// ---------- Service ----------

export const batchJobService = {
  /** GET /jobs — rows arrive under data.jobs, not data.rows. */
  getAll: async (params: ListParams = {}): Promise<BatchJobPage> => {
    const response = await api.get<BackendResponse<RawJobList>>(BASE, {
      params,
    });
    const raw = response.data;
    return {
      rows: raw?.jobs ?? [],
      total: raw?.total ?? 0,
      page: raw?.page ?? params.page ?? 1,
      limit: raw?.limit ?? params.limit ?? 10,
      totalPages: raw?.totalPages ?? 1,
    };
  },

  /** GET /jobs/:id */
  getById: async (id: string): Promise<BatchJob> => {
    const response = await api.get<BackendResponse<BatchJob>>(`${BASE}/${id}`);
    return response.data;
  },

  /**
   * POST /jobs/test — enqueues a demo job. The backend reads only
   * { type, totalItems }; anything else is ignored.
   */
  createTestJob: async (input: TestJobInput = {}): Promise<BatchJob> => {
    const response = await api.post<BackendResponse<BatchJob>>(
      `${BASE}/test`,
      input,
    );
    return response.data;
  },
};

export default batchJobService;
