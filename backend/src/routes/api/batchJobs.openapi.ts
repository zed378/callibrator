/**
 * P9-18 / P9-25 (ADR-103) — the contract of `batchJobs.route.ts`, code-first.
 *
 * Every route sits behind `router.use(auth)` and the seeded `batch-jobs` menu
 * (AZ-01 / G-05): read to list and inspect, write to enqueue. A job of another
 * tenant answers 404 like one that does not exist. Examples are synthetic.
 *
 * The list answers the house envelope: rows in `data`, pagination in a
 * top-level `meta` (A-342, fixed 2026-10-02; it was `data.jobs`).
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const timestamp = z.iso.datetime();
const JOB = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";

const BatchJob = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    userId: z.guid().nullable(),
    type: z.string(),
    status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]),
    progress: z.number().int(),
    totalItems: z.number().int().nullable(),
    processedItems: z.number().int(),
    resultUrl: z.string().nullable(),
    // P9-25: the model's failure text (null on a read; absent on POST /test's fresh row).
    errorDetails: z.string().nullable().optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .loose()
  .meta({
    id: "BatchJob",
    example: {
      id: JOB,
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      userId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      type: "EXPORT_CSV",
      status: "COMPLETED",
      progress: 100,
      totalItems: 10,
      processedItems: 10,
      resultUrl: null,
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:01:00.000Z",
    },
  });

const READ = { kind: "dynamicAccess", resource: "batch-jobs", action: "read" } as const;

export default defineRouteDocs({
  router: "api/batchJobs.route",
  mount: "/api/v1/jobs",
  tag: "BatchJobs",
  tagDescription: "Durable job runner for background tasks",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listBatchJobs",
      summary: "List the tenant's background jobs",
      permission: READ,
      audited: false,
      query: z.object({
        page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
        limit: z.coerce.number().int().min(1).optional().meta({ example: 10 }),
      }),
      success: { status: 200, description: "A page of jobs; pagination in the top-level `meta`", list: BatchJob },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getBatchJob",
      summary: "Get a job's status and progress",
      permission: READ,
      audited: false,
      params: z.object({ id: z.guid().meta({ description: "The job", example: JOB }) }),
      success: { status: 200, description: "The job", data: BatchJob },
    },
    {
      method: "post",
      path: "/test",
      operationId: "createTestBatchJob",
      summary: "Enqueue a test background job",
      description: "A type with no registered handler is refused (400, W-08).",
      permission: { kind: "dynamicAccess", resource: "batch-jobs", action: "write" },
      audited: false,
      body: z
        .object({
          type: z.string().optional().meta({ description: "Defaults to EXPORT_CSV", example: "EXPORT_CSV" }),
          totalItems: z.number().int().optional().meta({ description: "Defaults to 10", example: 10 }),
        })
        .meta({ description: "Read by the controller; not validated by a schema on the route." }),
      success: { status: 201, description: "The job", data: BatchJob },
    },
  ],
});
