const { Tenants, Users, Roles, MenuGroups, RoleMenuPermissions } = require("../models");
const { logger } = require("./activityLog.middleware");
const auditService = require("../services/audit.service");

// Valid AuditLog.action ENUM values — passing anything else would fail the insert.
const AUDIT_ACTIONS = new Set([
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "APPROVE",
  "EXPORT",
]);

/**
 * recordAudit(action, resourceType, opts?)
 *
 * Persists an immutable row to the `audit_logs` table (via auditService.logAction)
 * for a mutating request, AFTER the response completes successfully (status < 400).
 * This is the DB-backed compliance trail (FDA 21 CFR Part 11 §11.10(e)) — distinct
 * from auditAction/withAudit above, which only write to the rotating file logs.
 *
 * It is best-effort and non-blocking: a logging failure never affects the response.
 *
 * @param {string} action        One of CREATE|UPDATE|DELETE|LOGIN|APPROVE|EXPORT.
 * @param {string} resourceType  Logical entity name, e.g. "User", "Certificate".
 * @param {object} [opts]
 * @param {string}   [opts.idParam]          req.params key holding the resource id.
 * @param {function} [opts.resolveResourceId] (req,res) => id, overrides idParam.
 */
const recordAudit = (action, resourceType, opts = {}) => {
  if (!AUDIT_ACTIONS.has(action)) {
    throw new Error(`recordAudit: invalid audit action "${action}"`);
  }
  return (req, res, next) => {
    res.on("finish", () => {
      // Only record successful mutations.
      if (res.statusCode >= 400) {
        return;
      }
      let resourceId = null;
      try {
        if (typeof opts.resolveResourceId === "function") {
          resourceId = opts.resolveResourceId(req, res) || null;
        } else if (opts.idParam) {
          resourceId = req.params?.[opts.idParam] || null;
        } else {
          resourceId = req.params?.id || null;
        }
      } catch {
        resourceId = null;
      }
      auditService
        .logAction({
          tenantId: req.tenantId || req.user?.tenantId || null,
          userId: req.user?.id || null,
          action,
          resourceType,
          resourceId,
          ipAddress: req.ip || req.headers?.["x-forwarded-for"] || null,
          userAgent:
            (typeof req.get === "function" && req.get("User-Agent")) || null,
        })
        .catch(() => {
          /* best-effort: logAction already logs its own failures */
        });
    });
    next();
  };
};

/**
 * Audit Logging Middleware
 * Logs role and permission changes for compliance and debugging.
 *
 * Usage:
 *   router.post("/roles", auditAction("role_create", "Role"), createRole);
 *   router.delete("/roles/:id", auditAction("role_delete", "Role"), deleteRole);
 */

const auditAction = (action, resource) => {
  return async (req, res, next) => {
    const start = Date.now();
    const userId = req.user?.id || "anonymous";
    const tenantId = req.user?.tenantId || null;

    // Log the action before it happens
    logger.info(`AUDIT: ${action}`, {
      userId,
      tenantId,
      resource,
      action,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      body: req.body,
      params: req.params,
    });

    // Intercept res.json to log the result after the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const duration = Date.now() - start;
      logger.info(`AUDIT: ${action} complete`, {
        userId,
        tenantId,
        resource,
        action,
        statusCode: res.statusCode,
        durationMs: duration,
        success: res.statusCode < 400,
        response: body,
      });
      return originalJson(body);
    };

    next();
  };
};

/**
 * Audit middleware that wraps any existing middleware
 * Logs the action before and after the wrapped handler
 */
const withAudit = (action, resource) => (handler) => {
  return async (req, res, next) => {
    const start = Date.now();
    const userId = req.user?.id || "anonymous";
    const tenantId = req.user?.tenantId || null;

    logger.info(`AUDIT START: ${action}`, {
      userId,
      tenantId,
      resource,
      action,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    try {
      await handler(req, res, next);

      const duration = Date.now() - start;
      logger.info(`AUDIT COMPLETE: ${action}`, {
        userId,
        tenantId,
        resource,
        action,
        statusCode: res.statusCode,
        durationMs: duration,
        success: res.statusCode < 400,
      });
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`AUDIT ERROR: ${action}`, {
        userId,
        tenantId,
        resource,
        action,
        error: error.message,
        durationMs: duration,
      });
      throw error;
    }
  };
};

module.exports = { auditAction, withAudit, recordAudit };
