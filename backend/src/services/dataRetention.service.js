const { Op } = require('sequelize');
const { AuditLog, Notification, Session, TenantSettings } = require('../models');
const { AppError } = require('../utils/appError.util');
const { logger } = require('../middlewares/activityLog.middleware');

const DEFAULT_RETENTION_DAYS = {
  audit_logs: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10),
  notifications: parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '90', 10),
  sessions: parseInt(process.env.SESSION_RETENTION_DAYS || '30', 10),
};

/**
 * Data Retention & Purge Service
 *
 * Manages:
 * - Automated purging of old records based on retention policies
 * - Legal hold (prevents purge for specific tenants/records)
 * - PII masking for anonymized datasets
 */

exports.getRetentionPolicy = async (tenantId) => {
  const policies = await TenantSettings.findAll({
    where: {
      tenantId,
      key: { [Op.like]: 'retention_policy_%' },
    },
  });

  const result = { ...DEFAULT_RETENTION_DAYS };
  policies.forEach((p) => {
    const key = p.key.replace('retention_policy_', '');
    result[key] = parseInt(p.value, 10);
  });

  return result;
};

exports.setRetentionPolicy = async (tenantId, policyKey, days) => {
  if (!(policyKey in DEFAULT_RETENTION_DAYS)) {
    throw new AppError(400, `Unknown retention policy: ${policyKey}`);
  }

  if (days < 0) {
    throw new AppError(400, 'Retention days must be non-negative');
  }

  await TenantSettings.upsert({
    tenantId,
    key: `retention_policy_${policyKey}`,
    value: String(days),
  });

  return { policyKey, days };
};

exports.isOnLegalHold = async (tenantId) => {
  const setting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: 'legal_hold_enabled',
    },
  });

  return setting?.value === 'true';
};

exports.enableLegalHold = async (tenantId, enabledBy, reason) => {
  await TenantSettings.upsert({
    tenantId,
    key: 'legal_hold_enabled',
    value: 'true',
  });

  await TenantSettings.upsert({
    tenantId,
    key: 'legal_hold_reason',
    value: reason || 'Legal hold enabled',
  });

  await TenantSettings.upsert({
    tenantId,
    key: 'legal_hold_enabled_by',
    value: enabledBy,
  });

  logger.warn(`Legal hold enabled for tenant ${tenantId}`, { reason, enabledBy });

  return { tenantId, enabled: true, reason, enabledBy };
};

exports.disableLegalHold = async (tenantId, disabledBy) => {
  await TenantSettings.destroy({
    where: {
      tenantId,
      key: ['legal_hold_enabled', 'legal_hold_reason', 'legal_hold_enabled_by'],
    },
  });

  logger.info(`Legal hold disabled for tenant ${tenantId}`, { disabledBy });

  return { tenantId, enabled: false, disabledBy };
};

exports.purgeExpiredRecords = async (tenantId) => {
  const onLegalHold = await exports.isOnLegalHold(tenantId);

  if (onLegalHold) {
    logger.info(`Purge skipped for tenant ${tenantId}: legal hold active`);
    return { skipped: true, reason: 'legal_hold' };
  }

  const policies = await exports.getRetentionPolicy(tenantId);
  const now = new Date();
  const results = {};

  for (const [entity, retentionDays] of Object.entries(policies)) {
    if (retentionDays <= 0) {
      continue;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    let deletedCount = 0;

    switch (entity) {
      case 'audit_logs':
        deletedCount = await AuditLog.destroy({
          where: {
            tenantId,
            createdAt: { [Op.lt]: cutoff },
          },
        });
        break;

      case 'notifications':
        deletedCount = await Notification.destroy({
          where: {
            tenantId,
            createdAt: { [Op.lt]: cutoff },
          },
        });
        break;

      case 'sessions':
        deletedCount = await Session.destroy({
          where: {
            // The Session model names this attribute `tenant_id` (not tenantId),
            // so querying by `tenantId` throws "column tenantId does not exist".
            tenant_id: tenantId,
            createdAt: { [Op.lt]: cutoff },
          },
        });
        break;
    }

    if (deletedCount > 0) {
      results[entity] = deletedCount;
    }
  }

  logger.info(`Purge completed for tenant ${tenantId}`, results);

  return { tenantId, purged: results, skipped: false };
};

/**
 * Run the retention purge across every tenant. Intended for the scheduled job:
 * it has no request/tenant CLS context, so the isolation hooks run unscoped and
 * each purgeExpiredRecords call confines itself with its explicit tenantId
 * predicate. Per-tenant failures are logged and counted, never fatal.
 *
 * @returns {Promise<{tenants:number, purged:number, skipped:number, errors:number}>}
 */
exports.runRetentionSweep = async () => {
  const { Tenant } = require('../models');
  const tenants = await Tenant.findAll({ attributes: ['id'] });

  const summary = { tenants: tenants.length, purged: 0, skipped: 0, errors: 0 };

  for (const tenant of tenants) {
    try {
      const result = await exports.purgeExpiredRecords(tenant.id);
      if (result.skipped) {
        summary.skipped += 1;
      } else {
        summary.purged += Object.values(result.purged || {}).reduce(
          (sum, n) => sum + n,
          0,
        );
      }
    } catch (err) {
      summary.errors += 1;
      logger.error(
        `Retention sweep failed for tenant ${tenant.id}: ${err.message}`,
      );
    }
  }

  logger.info('Retention sweep complete', summary);
  return summary;
};

exports.maskPII = async (tenantId, entityType, recordIds) => {
  const onLegalHold = await exports.isOnLegalHold(tenantId);

  if (onLegalHold) {
    throw new AppError(400, 'Cannot mask PII while legal hold is active');
  }

  const maskMap = {
    users: { fields: ['email', 'firstName', 'lastName', 'phone'], mask: '[REDACTED]' },
    audit_logs: { fields: ['ipAddress', 'userAgent'], mask: '[REDACTED]' },
  };

  const config = maskMap[entityType];
  if (!config) {
    throw new AppError(400, `Unknown entity type for PII masking: ${entityType}`);
  }

  const Model = require('../models')[entityType.charAt(0).toUpperCase() + entityType.slice(1, -1)];
  if (!Model) {
    throw new AppError(400, `Model not found for entity type: ${entityType}`);
  }

  const updates = {};
  config.fields.forEach((field) => {
    updates[field] = config.mask;
  });

  await Model.update(updates, {
    where: {
      id: { [Op.in]: recordIds },
      tenantId,
    },
  });

  logger.info(`PII masked for ${entityType}`, { tenantId, recordIds, fields: config.fields });

  return { masked: recordIds.length, fields: config.fields };
};

exports.anonymizeDataset = async (tenantId, entityType, options = {}) => {
  const onLegalHold = await exports.isOnLegalHold(tenantId);

  if (onLegalHold) {
    throw new AppError(400, 'Cannot anonymize dataset while legal hold is active');
  }

  const { keepDates = true, keepNumericIds = true } = options;

  const Model = require('../models')[entityType.charAt(0).toUpperCase() + entityType.slice(1, -1)];
  if (!Model) {
    throw new AppError(400, `Model not found for entity type: ${entityType}`);
  }

  const records = await Model.findAll({ where: { tenantId } });
  const updates = {};

  for (const record of records) {
    const recordUpdates = {};

    for (const attr of Object.values(Model.rawAttributes)) {
      if (attr.type.key === 'STRING' && attr.fieldName !== 'id') {
        recordUpdates[attr.fieldName] = '[ANONYMIZED]';
      } else if (!keepDates && attr.type.key === 'DATE') {
        recordUpdates[attr.fieldName] = new Date('1970-01-01');
      }
    }

    if (!keepNumericIds) {
      recordUpdates.id = require('crypto').randomUUID();
    }

    await record.update(recordUpdates);
  }

  logger.info(`Dataset anonymized for ${entityType}`, { tenantId, count: records.length });

  return { anonymized: records.length, entityType };
};
