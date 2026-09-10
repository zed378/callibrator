const fs = require("fs");
const path = require("path");
const {
  createBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupStats,
} = require("../services/tenantBackup.service");
const { AppError } = require("../utils/appError.util");
const { TenantBackup, Users, Tenants } = require("../models");
const { success } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");

/**
 * Create a new backup for a tenant
 * POST /api/v1/tenants/:tenantId/backups
 */
exports.createBackup = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { name, description, backupType, retentionDays, tag } = req.body;
  const user = req.user;

  // Validate required fields
  if (!name) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "Backup name is required",
      data: null,
    });
  }

  const result = await createBackup({
    tenantId,
    createdById: user.id,
    name,
    description,
    backupType,
    retentionDays,
    tag,
    models: req.models,
  });

  success(
    res,
    result.data,
    null,
    result.message || "Backup created successfully",
    result.status || 201,
  );
});

/**
 * Get all backups for a tenant
 * GET /api/v1/tenants/:tenantId/backups
 */
exports.getBackups = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { status, backupType, tag, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const result = await TenantBackup.getTenantBackups(
    {
      tenantId,
      status,
      backupType,
      tag,
      limit: parseInt(limit),
      offset,
    },
    req.models,
  );

  const meta = {
    total: result.count,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(result.count / parseInt(limit)),
  };

  success(res, result.rows, meta, "Backups retrieved successfully", 200);
});

/**
 * Get a specific backup
 * GET /api/v1/tenants/:tenantId/backups/:backupId
 */
exports.getBackup = asyncHandler(async (req, res) => {
  const { backupId } = req.params;

  const backup = await TenantBackup.findByPk(backupId, {
    include: [
      {
        model: Users,
        as: "creator",
        attributes: ["id", "username", "email"],
      },
      {
        model: Tenants,
        as: "tenant",
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
});

/**
 * Download a backup file
 * GET /api/v1/tenants/:tenantId/backups/:backupId/download
 */
exports.downloadBackup = asyncHandler(async (req, res) => {
  const { backupId } = req.params;

  // The service returns a {success,status,message,data} envelope; filePath and
  // metadata live under `.data`. Reading them off the envelope directly made
  // `result.metadata` undefined and threw on every download.
  const { data } = await downloadBackup(backupId, req.models);
  const { filePath, metadata } = data;

  // There is no `filename` column — derive it from the stored path.
  const filename = path.basename(filePath);

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Length",
    metadata?.fileSize || fs.statSync(filePath).size,
  );

  return res.download(filePath, filename);
});

/**
 * Restore a backup
 * POST /api/v1/tenants/:tenantId/backups/:backupId/restore
 */
exports.restoreBackup = asyncHandler(async (req, res) => {
  const { backupId } = req.params;
  const { mergeData = false } = req.body;
  const user = req.user;

  const result = await restoreBackup({
    backupId,
    restoredById: user.id,
    mergeData: mergeData === true || mergeData === "true",
    models: req.models,
  });

  success(
    res,
    result.data,
    null,
    result.message || "Backup restored successfully",
    200,
  );
});

/**
 * Delete a backup
 * DELETE /api/v1/tenants/:tenantId/backups/:backupId
 */
exports.deleteBackup = asyncHandler(async (req, res) => {
  const { backupId } = req.params;
  const user = req.user;

  const result = await deleteBackup(backupId, user.id, req.models);

  success(
    res,
    result.data,
    null,
    result.message || "Backup deleted successfully",
    200,
  );
});

/**
 * Get backup statistics
 * GET /api/v1/tenants/:tenantId/backups/stats
 */
exports.getBackupStats = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  const stats = await getBackupStats(tenantId, req.models);

  // This service returns its own {success,status,message,data} envelope (as
  // createBackup/restoreBackup above do), so unwrap `.data` — passing `stats`
  // whole nested a second envelope and put the real payload at data.data.
  success(
    res,
    stats.data,
    null,
    stats.message || "Backup statistics retrieved successfully",
    stats.status || 200,
  );
});
