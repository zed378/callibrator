const { Op } = require('sequelize');
const { Tenant, TenantSettings, User, Subscription, Invoice } = require('../models');
const { AppError } = require('../utils/appError.util');
const { logger } = require('../middlewares/activityLog.middleware');
const { isEnabled } = require('./featureFlag.service');

const GRACE_PERIOD_DAYS = parseInt(process.env.TENANT_GRACE_PERIOD_DAYS || '7', 10);
const OFFBOARD_RETENTION_DAYS = parseInt(process.env.TENANT_OFFBOARD_RETENTION_DAYS || '30', 10);

/**
 * Tenant Lifecycle Service
 *
 * Manages tenant states through their lifecycle:
 * - trial → active → suspended (dunning) → active → offboarded
 *
 * States:
 * - ACTIVE: normal operation
 * - SUSPENDED: dunning / payment failure / admin action
 * - TRIAL: free trial period
 * - OFFBOARDED: scheduled for deletion after retention period
 */

exports.suspendTenant = async (tenantId, reason, suspendedBy = null) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status === 'suspended') {
    return tenant;
  }

  tenant.status = 'suspended';
  tenant.suspensionReason = reason;
  tenant.suspendedAt = new Date();
  tenant.suspendedBy = suspendedBy;
  await tenant.save();

  await logger.warn(`Tenant suspended: ${tenantId}`, { reason, suspendedBy });

  await TenantSettings.upsert({
    tenantId,
    key: 'lifecycle_status',
    value: 'SUSPENDED',
  });

  return tenant;
};

exports.resumeTenant = async (tenantId, resumedBy = null) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status === 'active') {
    return tenant;
  }

  tenant.status = 'active';
  tenant.suspensionReason = null;
  tenant.suspendedAt = null;
  tenant.suspendedBy = null;
  await tenant.save();

  await logger.info(`Tenant resumed: ${tenantId}`, { resumedBy });

  await TenantSettings.upsert({
    tenantId,
    key: 'lifecycle_status',
    value: 'ACTIVE',
  });

  return tenant;
};

exports.enterGracePeriod = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  const graceExpiresAt = new Date();
  graceExpiresAt.setDate(graceExpiresAt.getDate() + GRACE_PERIOD_DAYS);

  tenant.gracePeriodExpiresAt = graceExpiresAt;
  await tenant.save();

  await logger.info(`Tenant entered grace period: ${tenantId}`, {
    gracePeriodDays: GRACE_PERIOD_DAYS,
    expiresAt: graceExpiresAt,
  });

  return tenant;
};

exports.checkGracePeriodExpired = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant || !tenant.gracePeriodExpiresAt) {
    return false;
  }

  return new Date() > new Date(tenant.gracePeriodExpiresAt);
};

exports.offboardTenant = async (tenantId, force = false) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status === 'deleted' && !force) {
    return tenant;
  }

  const exportData = await this.exportTenantData(tenantId);

  tenant.status = 'deleted';
  tenant.offboardedAt = new Date();
  tenant.offboardRetentionExpiresAt = new Date();
  tenant.offboardRetentionExpiresAt.setDate(
    tenant.offboardRetentionExpiresAt.getDate() + OFFBOARD_RETENTION_DAYS
  );
  await tenant.save();

  // tenant.status uses the enum's terminal 'deleted'; the granular lifecycle
  // state lives in the lifecycle_status setting that getStatus surfaces.
  await TenantSettings.upsert({
    tenantId,
    key: 'lifecycle_status',
    value: 'OFFBOARDED',
  });

  await logger.warn(`Tenant offboarded: ${tenantId}`, {
    retentionDays: OFFBOARD_RETENTION_DAYS,
    expiresAt: tenant.offboardRetentionExpiresAt,
  });

  return { tenant, exportData };
};

exports.cancelOffboarding = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status !== 'deleted') {
    throw new AppError(400, 'Tenant is not offboarded');
  }

  tenant.status = 'active';
  tenant.offboardedAt = null;
  tenant.offboardRetentionExpiresAt = null;
  await tenant.save();

  await logger.info(`Offboarding cancelled for tenant: ${tenantId}`);

  return tenant;
};

exports.hardDeleteOffboardedTenant = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status !== 'deleted') {
    throw new AppError(400, 'Tenant is not offboarded');
  }

  if (tenant.offboardRetentionExpiresAt && new Date() < new Date(tenant.offboardRetentionExpiresAt)) {
    throw new AppError(400, 'Retention period has not expired yet');
  }

  await User.destroy({ where: { tenantId }, force: true });
  await Subscription.destroy({ where: { tenantId }, force: true });
  await Invoice.destroy({ where: { tenantId }, force: true });
  await TenantSettings.destroy({ where: { tenantId }, force: true });

  await tenant.destroy({ force: true });

  await logger.warn(`Hard-deleted offboarded tenant: ${tenantId}`);

  return true;
};

exports.exportTenantData = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  const users = await User.findAll({ where: { tenantId } });
  const settings = await TenantSettings.findAll({ where: { tenantId } });
  const subscriptions = await Subscription.findAll({ where: { tenantId } });
  const invoices = await Invoice.findAll({ where: { tenantId } });

  return {
    tenant: tenant.toJSON(),
    users: users.map((u) => u.toJSON()),
    settings: settings.map((s) => s.toJSON()),
    subscriptions: subscriptions.map((s) => s.toJSON()),
    invoices: invoices.map((i) => i.toJSON()),
    exportedAt: new Date(),
  };
};

exports.getTenantLifecycleStatus = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  const lifecycleSetting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: 'lifecycle_status',
    },
  });

  const gracePeriodExpired = await exports.checkGracePeriodExpired(tenantId);

  return {
    status: tenant.status,
    lifecycleStatus: lifecycleSetting?.value || tenant.status,
    gracePeriodExpiresAt: tenant.gracePeriodExpiresAt,
    gracePeriodExpired,
    offboardedAt: tenant.offboardedAt,
    offboardRetentionExpiresAt: tenant.offboardRetentionExpiresAt,
  };
};

exports.processExpiredGracePeriods = async () => {
  const tenants = await Tenant.findAll({
    where: {
      status: 'SUSPENDED',
      gracePeriodExpiresAt: { [Op.ne]: null },
    },
  });

  const now = new Date();
  const results = [];

  for (const tenant of tenants) {
    if (new Date(tenant.gracePeriodExpiresAt) < now) {
      await exports.offboardTenant(tenant.id);
      results.push({ tenantId: tenant.id, action: 'offboarded' });
    }
  }

  logger.info(`Processed ${tenants.length} grace periods`, { results });

  return results;
};
