/**
 * The upstream import's stage 2, the transform (P24-01; ADR-129 § 10 and Amendment 1;
 * docs/UPSTREAM/05 § 3 – § 8): a LOADED SQL-dump run is turned into the application's rows by
 * the steps of upstreamImport/transform/steps.ts, every staged row ending in
 * `upstream_import.id_map` or `upstream_import.quarantine`.
 *
 *   not_available ──(request)──► transform_requested ──(worker)──► transforming ──► transformed
 *         ▲                                                              │
 *         └───── transformed / transform_failed may be requested again    └──► transform_failed
 *
 * Every transition is a conditional UPDATE with its audit row in ONE transaction (actor: the
 * super admin for the request, `system:upstream-sql-import` for the worker), under the PLATFORM
 * tenant — as the stage-1 transitions are. One transform at a time: the partial UNIQUE index
 * `upstream_sql_imports_one_transforming` (0133) and the runner's advisory lock.
 *
 * The transform itself runs on its own connection, switched to the transform role (0133): it
 * alone reads staging and writes the bookkeeping. The application's connection never touches
 * `upstream_import`.
 *
 * THE DPIA GATE: a run declared `real` is refused while UPSTREAM_REAL_DATA_ALLOWED is off — at
 * the request (403) and again by the worker before it reads a staged row.
 *
 * Until P24-02 builds the steps, `transformAvailable()` is false and a request is refused 409
 * `TRANSFORM_NOT_AVAILABLE`: the mechanism is built, the transforms are not.
 */
import { Op, type Transaction } from "sequelize";
import type { UpstreamSqlImportTransformErrorCode, UpstreamSqlImportTransformStatus } from "@callibrator/contracts/upstreamSqlImport";
import models from "../models";
import { db } from "../config";
import { upstreamRealDataAllowed } from "../config/upstream";
import { createTransformDb, transformRoleName } from "../config/upstreamImport";
import { CodedError } from "../utils/codedError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import auditService from "./audit.service";
import batchJobService from "./batchJob.service";
import { TRANSFORM_STEPS, isBuilt } from "./upstreamImport/transform/steps";
import { TransformFailure, runTransform } from "./upstreamImport/transform/runner";
import type { ModelInstance } from "../types/models";
import type { SqlRunner } from "../utils/sql.util";

const { UpstreamSqlImport, BatchJob } = models;

type Run = ModelInstance<"UpstreamSqlImport">;

/** The batch-job type the transform runs as. */
export const UPSTREAM_SQL_TRANSFORM_JOB_TYPE = "upstream-sql-transform";

/** The transform statuses a new request may start from. */
const REQUESTABLE: readonly UpstreamSqlImportTransformStatus[] = ["not_available", "transformed", "transform_failed"];

/** The transform statuses of a transform in progress. */
const IN_PROGRESS: readonly UpstreamSqlImportTransformStatus[] = ["transform_requested", "transforming"];

/** How long a requested transform with no job yet is given before it counts as lost. */
const QUEUE_GRACE_MS = 10 * 60 * 1000;

/** Who requests a transform. */
export interface TransformActor {
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** Whether the transform's steps are built (P24-02) — the page's `transformAvailable`. */
export const transformAvailable = (): boolean => isBuilt(TRANSFORM_STEPS);

/** One transform transition's audit row, under the PLATFORM tenant, in `transaction`. */
const auditTransform = (
  transaction: Transaction,
  run: Run,
  from: UpstreamSqlImportTransformStatus,
  to: UpstreamSqlImportTransformStatus,
  actor: TransformActor | null,
  extra: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID,
      ...(actor === null ? { systemActor: SYSTEM_ACTORS.UPSTREAM_SQL_IMPORT } : { userId: actor.userId }),
      action: "UPDATE",
      resourceType: "UpstreamSqlImport",
      resourceId: run.id,
      changes: { operation: "UPSTREAM_SQL_IMPORT_TRANSFORM_STATE", before: { transformStatus: from }, after: { transformStatus: to }, ...extra },
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent ?? null,
    },
    { transaction },
  );

/**
 * A conditional transform transition with its audit row.
 * @returns whether the run was in `from` (and is now in `to`)
 */
const transition = (
  run: Run,
  from: UpstreamSqlImportTransformStatus,
  to: UpstreamSqlImportTransformStatus,
  values: Partial<Run["_attributes"]>,
  actor: TransformActor | null,
  extra: Record<string, unknown> = {},
): Promise<boolean> =>
  db.transaction(async (transaction) => {
    const [count] = await UpstreamSqlImport.update(
      { ...values, transformStatus: to },
      { where: { id: run.id, status: "loaded", transformStatus: from }, transaction },
    );
    if (count === 0) {
      return false;
    }
    await run.reload({ transaction });
    await auditTransform(transaction, run, from, to, actor, extra);
    return true;
  });

const isUniqueViolation = (err: unknown): boolean => (err as { name?: unknown }).name === "SequelizeUniqueConstraintError";

/**
 * POST /admin/upstream-sql-imports/:id/transform — queue the transform of a loaded run.
 * @throws {CodedError} 404 UPSTREAM_SQL_IMPORT_NOT_FOUND; 409 TRANSFORM_NOT_AVAILABLE (steps not built),
 *   RUN_NOT_LOADED, TRANSFORM_IN_PROGRESS (this run or another); 403 REAL_DATA_NOT_ALLOWED
 */
export const requestTransform = async (id: string, actor: TransformActor): Promise<void> => {
  const run = await UpstreamSqlImport.findByPk(id);
  if (run === null) {
    throw new CodedError(404, "UPSTREAM_SQL_IMPORT_NOT_FOUND", "Import run not found");
  }
  if (!transformAvailable()) {
    throw new CodedError(
      409,
      "TRANSFORM_NOT_AVAILABLE",
      "The transform into the application's tables is not built on this server yet: the run stays staged.",
    );
  }
  if (run.status !== "loaded") {
    throw new CodedError(409, "RUN_NOT_LOADED", `The run is ${run.status}; only a loaded run can be transformed.`, { status: run.status });
  }
  if (IN_PROGRESS.includes(run.transformStatus)) {
    throw new CodedError(409, "TRANSFORM_IN_PROGRESS", `The run's transform is already ${run.transformStatus}.`, {
      transformStatus: run.transformStatus,
    });
  }
  if (run.dataClass === "real" && !upstreamRealDataAllowed()) {
    throw new CodedError(
      403,
      "REAL_DATA_NOT_ALLOWED",
      "The run is declared real upstream data and UPSTREAM_REAL_DATA_ALLOWED is off (DPIA gates R-01, R-03, R-17).",
    );
  }
  const from = run.transformStatus;
  let moved: boolean;
  try {
    moved = await transition(
      run,
      from,
      "transform_requested",
      {
        transformRequestedAt: new Date(),
        transformRequestedBy: actor.userId,
        transformStartedAt: null,
        transformFinishedAt: null,
        transformErrorCode: null,
        transformBatchJobId: null,
      },
      actor,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CodedError(409, "TRANSFORM_IN_PROGRESS", "Another run's transform is in progress; wait for it to finish.");
    }
    throw err;
  }
  if (!moved) {
    throw new CodedError(409, "TRANSFORM_IN_PROGRESS", "The run's transform has just been requested or started.");
  }
  const job = await batchJobService.createJob(PLATFORM_TENANT_ID, actor.userId, UPSTREAM_SQL_TRANSFORM_JOB_TYPE, 0);
  await UpstreamSqlImport.update({ transformBatchJobId: job.id }, { where: { id: run.id, transformBatchJobId: null } });
};

const failureCodeOf = (err: unknown): UpstreamSqlImportTransformErrorCode =>
  err instanceof TransformFailure ? err.code : "TRANSFORM_FAILED";

const sqlStateOf = (err: unknown): string | null => {
  const code = (err as { parent?: { code?: unknown } }).parent?.code;
  return typeof code === "string" ? code : null;
};

/**
 * The batch-job handler: claim the requested transform, run it, record the outcome.
 * A failed transform ends its job FAILED (the code on the run); an already-claimed one completes it.
 */
export const runTransformJob = async (job: { id: string }): Promise<{ processedItems: number }> => {
  const run = await UpstreamSqlImport.findOne({
    where: { status: "loaded", transformStatus: "transform_requested", [Op.or]: [{ transformBatchJobId: null }, { transformBatchJobId: job.id }] },
    order: [["transformRequestedAt", "ASC"]],
  });
  if (run === null) {
    return { processedItems: 0 };
  }
  if (!(await transition(run, "transform_requested", "transforming", { transformBatchJobId: job.id, transformStartedAt: new Date() }, null))) {
    return { processedItems: 0 };
  }
  const connection = createTransformDb();
  try {
    if (run.dataClass === "real" && !upstreamRealDataAllowed()) {
      throw new TransformFailure("REAL_DATA_NOT_ALLOWED", "UPSTREAM_REAL_DATA_ALLOWED is off");
    }
    const summary = await runTransform({
      runId: run.id,
      db: connection,
      // As stage 1 does (upstreamSqlImport.service#stage): the Sequelize instance is sql()'s runner.
      runner: connection as unknown as SqlRunner,
      role: transformRoleName(),
      steps: TRANSFORM_STEPS,
    });
    await transition(run, "transforming", "transformed", { transformFinishedAt: new Date(), transformSummary: summary }, null, {
      steps: summary.steps.length,
    });
    return { processedItems: summary.steps.reduce((n, s) => n + s.sources.reduce((m, src) => m + src.mapped, 0), 0) };
  } catch (err) {
    const code = failureCodeOf(err);
    await transition(run, "transforming", "transform_failed", { transformFinishedAt: new Date(), transformErrorCode: code }, null, {
      transformErrorCode: code,
    });
    logger.warn("Upstream SQL transform failed", { runId: run.id, code, sqlState: sqlStateOf(err) });
    throw new Error(`Upstream SQL transform ${run.id} failed: ${code}`);
  } finally {
    await connection.close();
  }
};

batchJobService.registerHandler(UPSTREAM_SQL_TRANSFORM_JOB_TYPE, (job) => runTransformJob(job));

/**
 * A transform requested or running whose batch job has ended (or never existed past
 * QUEUE_GRACE_MS): `transform_failed`, INTERRUPTED. The transaction it ran in rolled back, so
 * nothing of it was kept.
 * @returns how many transforms were failed
 */
export const reconcileInterruptedTransforms = async (now: Date = new Date()): Promise<number> => {
  const active = await UpstreamSqlImport.findAll({ where: { status: "loaded", transformStatus: { [Op.in]: [...IN_PROGRESS] } } });
  let failed = 0;
  for (const run of active) {
    const job = run.transformBatchJobId
      ? await BatchJob.findByPk(run.transformBatchJobId, { attributes: ["status"], skipTenantScope: true })
      : null;
    const running = job !== null && (job.status === "PENDING" || job.status === "PROCESSING");
    const waiting = !run.transformBatchJobId && now.getTime() - run.updatedAt.getTime() < QUEUE_GRACE_MS;
    if (running || waiting) {
      continue;
    }
    const moved = await transition(
      run,
      run.transformStatus,
      "transform_failed",
      { transformErrorCode: "INTERRUPTED", transformFinishedAt: now },
      null,
      { transformErrorCode: "INTERRUPTED", jobStatus: job?.status ?? null },
    );
    failed += moved ? 1 : 0;
  }
  return failed;
};

/** The statuses a request may start from (for the view's `transformRequestable`). */
export const isTransformRequestable = (run: Pick<Run, "status" | "transformStatus">): boolean =>
  transformAvailable() && run.status === "loaded" && REQUESTABLE.includes(run.transformStatus);
