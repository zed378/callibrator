const { Op } = require("sequelize");
const { AuditLog, User } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { logger } = require("../middlewares/activityLog.middleware");

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
 * Emits an immutable audit log record. The single write path for `audit_logs`.
 *
 * A-41 / A-42 — two call shapes, and they fail differently on purpose
 * (MEMORY/specs/A-41-audit-inside-transaction.md § Decision):
 *
 *  - `logAction(entry, { transaction })` — the compliance-critical set. The row
 *    is written in the caller's transaction, so a rollback takes it with it;
 *    and a failed write is RE-THROWN, so the mutation cannot commit
 *    unattributed (21 CFR 11.10(e)). Swallowing it here would be worse than
 *    useless: PostgreSQL has already aborted the transaction, and a COMMIT of
 *    an aborted transaction silently rolls back — the caller would report
 *    success for a change that never happened.
 *  - `logAction(entry)` — no transaction (the after-response middleware). The
 *    mutation has already committed; throwing cannot undo it. The failure is
 *    logged and `null` returned.
 *
 * Either way a failure goes to winston at `error` — the file sink production
 * collects — never only to `console`, with enough context to find the action.
 *
 * @param {object} entry
 * @param {string} entry.tenantId
 * @param {string|null} entry.userId - the actor; null for a system job
 * @param {string} entry.action - one of AUDIT_ACTIONS
 * @param {string} entry.resourceType
 * @param {string|null} [entry.resourceId]
 * @param {object|null} [entry.changes] - never secrets: this table is permanent
 * @param {string|null} [entry.ipAddress]
 * @param {string|null} [entry.userAgent]
 * @param {object} [options]
 * @param {object} [options.transaction] - the mutation's transaction
 * @returns {Promise<object|null>} the row, or null after a logged failure outside a transaction
 * @throws the insert's error, when called with a transaction
 */
exports.logAction = async (
  {
    tenantId,
    userId,
    action,
    resourceType,
    resourceId = null,
    changes = null,
    ipAddress = null,
    userAgent = null,
  },
  { transaction } = {},
) => {
  try {
    if (!AUDIT_ACTIONS.includes(action)) {
      throw new Error(
        `Invalid audit action "${action}" — audit_logs.action accepts only ${AUDIT_ACTIONS.join(", ")}`,
      );
    }
    const newLog = await AuditLog.create(
      {
        tenantId,
        userId,
        action,
        resourceType,
        resourceId,
        changes,
        ipAddress,
        userAgent,
      },
      { transaction },
    );
    return transformLog(newLog);
  } catch (error) {
    logger.error("Audit log write failed", {
      tenantId,
      userId,
      action,
      resourceType,
      resourceId,
      inTransaction: Boolean(transaction),
      error: error.message,
      stack: error.stack,
    });
    if (transaction) {
      throw error;
    }
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
