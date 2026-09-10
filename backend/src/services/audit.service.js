const { Op } = require("sequelize");
const { db } = require("../config");
const { AuditLog, User } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformLog = (log) => {
  if (!log) {return null;}
  return log.toJSON ? log.toJSON() : { ...log };
};

const transformLogs = (rows) => (rows || []).map(transformLog);

// ------------------------------------------------------------------
// LOG ACTION (Internal Use Only)
// ------------------------------------------------------------------
/**
 * Emits an immutable audit log record.
 * Designed to be called by other internal services.
 */
exports.logAction = async ({
  tenantId,
  userId,
  action,
  resourceType,
  resourceId = null,
  changes = null,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    const newLog = await AuditLog.create({
      tenantId,
      userId,
      action,
      resourceType,
      resourceId,
      changes,
      ipAddress,
      userAgent,
    });
    return transformLog(newLog);
  } catch (error) {
    console.error("Failed to write audit log (CRITICAL):", error);
    // Depending on strictness of compliance, you may want to THROW here to block
    // the underlying transaction if logging fails. For now, we return null.
    return null;
  }
};

// ------------------------------------------------------------------
// FETCH AUDIT LOGS
// ------------------------------------------------------------------
exports.fetchAuditLogs = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  userId,
  action,
  resourceType,
  resourceId,
  startDate,
  endDate,
}) => {
  try {
    const whereClause = { tenantId };

    if (userId) {whereClause.userId = userId;}
    if (action) {whereClause.action = action;}
    if (resourceType) {whereClause.resourceType = resourceType;}
    if (resourceId) {whereClause.resourceId = resourceId;}

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {whereClause.createdAt[Op.gte] = new Date(startDate);}
      if (endDate) {whereClause.createdAt[Op.lte] = new Date(endDate);}
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await AuditLog.findAndCountAll({
      where: whereClause,
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"]],
      // required:false — userId is nullable (SET NULL on user delete) and User
      // carries a scope that would otherwise INNER JOIN and hide those logs.
      include: [
        { model: User, as: "user", attributes: ["id", "username", "firstName", "lastName", "email"], required: false },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch audit logs successful",
      data: {
        rows: transformLogs(rows),
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to fetch audit logs",
    };
  }
};
