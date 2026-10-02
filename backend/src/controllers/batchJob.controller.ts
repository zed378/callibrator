/**
 * Background jobs, `/api/v1/jobs`.
 *
 * P9-18 (ADR-087): converted from batchJob.controller.js, behaviour unchanged.
 * The handlers RETURN the envelope and `asyncHandlerWithMapping` sends it,
 * mapping "Job not found" to 404, as before. `req.user`, `req.params`,
 * `req.query` and `req.body` are read inline as the JavaScript read them; the
 * list paging is passed raw (the service coerces it). The service is read
 * through its module object at call time; the wrapper is captured at load.
 * `export =` keeps the exact object `require()` returned.
 *
 * A-342 (2026-10-02): the list answers the house envelope — the rows in
 * `data`, the pagination in a top-level `meta`. It answered
 * `data: { total, page, limit, totalPages, jobs }`.
 */
import type { Request } from "express";
import batchJobService from "../services/batchJob.service";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";

const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;

/** The principal `auth` set (read without a guard, as before). */
interface JobPrincipal {
  tenantId: string;
  id: string;
}

const createTestJob = asyncHandlerWithMapping(async (req: Request) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
  const { type, totalItems } = (req.body || {}) as { type?: string; totalItems?: number };
  const result = await batchJobService.createJob(
    (req.user as JobPrincipal).tenantId,
    (req.user as JobPrincipal).id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type or a 0 count takes the default
    type || "EXPORT_CSV",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    totalItems || 10,
  );
  return {
    success: true,
    status: 201,
    message: "Background job created",
    data: result,
  };
}, {});

const getJobs = asyncHandlerWithMapping(async (req: Request) => {
  const { page, limit } = req.query as { page?: string; limit?: string };
  const { jobs, total, page: currentPage, limit: pageLimit, totalPages } =
    await batchJobService.getJobs((req.user as JobPrincipal).tenantId, page, limit);
  return {
    success: true,
    status: 200,
    message: "Jobs retrieved successfully",
    // House envelope: rows in `data`, pagination in a top-level `meta` sibling (A-342).
    data: jobs,
    meta: { total, page: currentPage, limit: pageLimit, totalPages },
  };
}, {});

const getJobStatus = asyncHandlerWithMapping(async (req: Request) => {
  const result = await batchJobService.getJobStatus((req.user as JobPrincipal).tenantId, (req.params as { id: string }).id);
  return {
    success: true,
    status: 200,
    message: "Job status retrieved",
    data: result,
  };
}, {
  "Job not found": 404,
});

const controller = { createTestJob, getJobs, getJobStatus };

export = controller;
