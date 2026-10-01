// P9-20 (ADR-087): converted from tenantBackup.controller.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order; each handler keeps its name). `fs` and `path` are
// the module objects; the five service functions, `TenantBackup`, `Users`,
// `Tenants`, `success` and `asyncHandler` are captured at load, as the `.js`
// destructured them, and `models` is the barrel itself. The `.js` also
// destructured `AppError` and never used it; that unused name is gone.
// Request data is read through typed views of the request: the emitted
// expressions (`req.body` destructured without a fallback, `user.id`) and the
// TypeErrors a missing body or user throws are the `.js` ones.
import fs from "fs";
import path from "path";
import type { Request, Response } from "express";

import tenantBackupService from "../services/tenantBackup.service";
// P6-02: the services take the models barrel. This controller used to pass
// `req.models`, which no middleware sets — so every backup was created, then
// failed on `models.Users` with a 500 (found by the live E2E suite).
import models from "../models";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import type { TenantId, UserId } from "../types/ids";

const {
  createBackup: createBackupService,
  downloadBackup: downloadBackupService,
  restoreBackup: restoreBackupService,
  deleteBackup: deleteBackupService,
  getBackupStats: getBackupStatsService,
} = tenantBackupService;
const { TenantBackup, Users, Tenants } = models;
const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;

/** The path parameters these routes name (`validateUuid`). */
interface BackupParams extends Record<string, string> {
  tenantId: TenantId;
  backupId: string;
}

/** The principal `auth` put on the request. */
interface Caller {
  id: UserId;
}

/** The create body (the route validates it). */
interface CreateBody {
  name?: string | null;
  description?: string | null;
  backupType?: string;
  retentionDays?: number;
  tag?: string | null;
}

/** The list query, as the query string carries it. */
interface ListQuery {
  status?: Parameters<typeof TenantBackup.getTenantBackups>[0] extends infer O ? (O extends { status?: infer S } ? S : never) : never;
  backupType?: string;
  tag?: string;
  page?: string | number;
  limit?: string | number;
}

/**
 * Create a new backup for a tenant
 * POST /api/v1/tenants/:tenantId/backups
 */
const createBackup = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as BackupParams;
  const { name, description, backupType, retentionDays, tag } = req.body as CreateBody;
  const user = req.user as Caller;

  // Validate required fields
  if (!name) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Backup name is required",
      data: null,
    });
  }

  const result = await createBackupService({
    tenantId,
    createdById: user.id,
    name,
    description,
    backupType,
    retentionDays,
    tag,
    models,
  });

  success(
    res,
    result.data,
    null,
    // As built: an empty message falls back (`||`).
    result.message || "Backup created successfully",
    // As built: a 0 status falls back (`||`).
    result.status || 201,
  );
  return undefined;
});

/**
 * Get all backups for a tenant
 * GET /api/v1/tenants/:tenantId/backups
 */
const getBackups = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as BackupParams;
  const { status, backupType, tag, page = 1, limit = 20 } = req.query as ListQuery;
  // parseInt applies ToString to its argument, so String(x) reads exactly as parseInt(x) did.
  const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));

  const result = await TenantBackup.getTenantBackups(
    {
      tenantId,
      status,
      backupType,
      tag,
      limit: parseInt(String(limit)),
      offset,
    },
    models,
  );

  const meta = {
    total: result.count,
    page: parseInt(String(page)),
    limit: parseInt(String(limit)),
    totalPages: Math.ceil(result.count / parseInt(String(limit))),
  };

  success(res, result.rows, meta, "Backups retrieved successfully", 200);
});

/**
 * Get a specific backup
 * GET /api/v1/tenants/:tenantId/backups/:backupId
 */
const getBackup = asyncHandler(async (req: Request, res: Response) => {
  const { backupId } = req.params as BackupParams;

  const backup = await TenantBackup.findByPk(backupId, {
    include: [
      // A-90: LEFT JOINs — a backup whose creator is deleted or outside the
      // tenant, or whose tenant row is soft-deleted, is still found.
      {
        model: Users,
        as: "creator",
        attributes: ["id", "username", "email"],
        required: false,
      },
      {
        model: Tenants,
        as: "tenant",
        required: false,
      },
    ],
  });

  if (!backup) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: "Backup not found",
      data: null,
    });
  }

  success(res, backup, null, "Backup retrieved successfully", 200);
  return undefined;
});

/**
 * Download a backup file
 * GET /api/v1/tenants/:tenantId/backups/:backupId/download
 */
const downloadBackup = asyncHandler(async (req: Request, res: Response) => {
  const { backupId } = req.params as BackupParams;

  // The service returns a {success,status,message,data} envelope; filePath and
  // metadata live under `.data`. Reading them off the envelope directly made
  // `result.metadata` undefined and threw on every download.
  const { data } = await downloadBackupService(backupId, models);
  const { filePath, metadata } = data;

  // There is no `filename` column — derive it from the stored path.
  const filename = path.basename(filePath);

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Length",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: a 0 or empty size falls back to the file's
    metadata?.fileSize || fs.statSync(filePath).size,
  );

  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the handler resolves to what res.download returns
  return res.download(filePath, filename);
});

/**
 * Restore a backup
 * POST /api/v1/tenants/:tenantId/backups/:backupId/restore
 */
const restoreBackup = asyncHandler(async (req: Request, res: Response) => {
  const { backupId } = req.params as BackupParams;
  const { mergeData = false } = req.body as { mergeData?: unknown };
  const user = req.user as Caller;

  const result = await restoreBackupService({
    backupId,
    restoredById: user.id,
    mergeData: mergeData === true || mergeData === "true",
    models,
  });

  success(
    res,
    result.data,
    null,
    // As built: an empty message falls back (`||`).
    result.message || "Backup restored successfully",
    200,
  );
});

/**
 * Delete a backup
 * DELETE /api/v1/tenants/:tenantId/backups/:backupId
 */
const deleteBackup = asyncHandler(async (req: Request, res: Response) => {
  const { backupId } = req.params as BackupParams;
  const user = req.user as Caller;

  const result = await deleteBackupService(backupId, user.id, models);

  success(
    res,
    result.data,
    null,
    // As built: an empty message falls back (`||`).
    result.message || "Backup deleted successfully",
    200,
  );
});

/**
 * Get backup statistics
 * GET /api/v1/tenants/:tenantId/backups/stats
 */
const getBackupStats = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as BackupParams;

  const stats = await getBackupStatsService(tenantId, models);

  // This service returns its own {success,status,message,data} envelope (as
  // createBackup/restoreBackup above do), so unwrap `.data` — passing `stats`
  // whole nested a second envelope and put the real payload at data.data.
  success(
    res,
    stats.data,
    null,
    // As built: an empty message falls back (`||`).
    stats.message || "Backup statistics retrieved successfully",
    // As built: a 0 status falls back (`||`).
    stats.status || 200,
  );
});

const controller = {
  createBackup,
  getBackups,
  getBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupStats,
};

export = controller;
