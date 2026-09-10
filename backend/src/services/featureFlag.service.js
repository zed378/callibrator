const { TenantSettings } = require('../models');
const { AppError } = require('../utils/appError.util');

const FEATURE_FLAG_CATEGORIES = {
  PLATFORM: 'platform',
  CALIBRATION: 'calibration',
  BILLING: 'billing',
  COMPLIANCE: 'compliance',
  AI: 'ai',
  FIELD_SERVICE: 'field_service',
  INTEGRATION: 'integration',
};

const DEFAULT_FLAGS = {
  enable_iot: { category: FEATURE_FLAG_CATEGORIES.CALIBRATION, defaultValue: true, description: 'Enable IoT sensor ingestion and predictive maintenance' },
  enable_ai_ocr: { category: FEATURE_FLAG_CATEGORIES.AI, defaultValue: true, description: 'Enable AI-powered OCR for external certificates' },
  enable_rag: { category: FEATURE_FLAG_CATEGORIES.AI, defaultValue: true, description: 'Enable RAG over tenant documents' },
  enable_scheduler: { category: FEATURE_FLAG_CATEGORIES.CALIBRATION, defaultValue: true, description: 'Enable calibration scheduler and reminders' },
  enable_mfa: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: 'Require MFA for all users' },
  enable_webauthn: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: 'Enable WebAuthn/passkey login' },
  enable_scim: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: true, description: 'Enable SCIM 2.0 provisioning' },
  enable_sandbox: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: 'Enable sandbox tenant creation' },
  enable_metered_billing: { category: FEATURE_FLAG_CATEGORIES.BILLING, defaultValue: false, description: 'Enable usage-based metered billing' },
  enable_customer_portal: { category: FEATURE_FLAG_CATEGORIES.FIELD_SERVICE, defaultValue: false, description: 'Enable external customer portal' },
  enable_scheduling: { category: FEATURE_FLAG_CATEGORIES.FIELD_SERVICE, defaultValue: false, description: 'Enable calendar/resource scheduling' },
  enable_qms_depth: { category: FEATURE_FLAG_CATEGORIES.COMPLIANCE, defaultValue: true, description: 'Enable advanced QMS features (CAPA, SOP, training)' },
  enable_e_signature: { category: FEATURE_FLAG_CATEGORIES.COMPLIANCE, defaultValue: false, description: 'Enable 21 CFR Part 11 e-signature workflow' },
  enable_data_residency: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: 'Enable tenant data residency routing' },
};

/**
 * Check if a feature flag is enabled for a tenant.
 *
 * Resolution order:
 * 1. TenantSettings override (tenant-specific)
 * 2. Plan default (from DEFAULT_FLAGS)
 * 3. Global default (false)
 */
exports.isEnabled = async (tenantId, flagKey) => {
  const flagDef = DEFAULT_FLAGS[flagKey];
  if (!flagDef) {
    return false;
  }

  const setting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: `feature_flag_${flagKey}`,
    },
  });

  if (setting) {
    return setting.value === 'true' || setting.value === true;
  }

  return flagDef.defaultValue === true;
};

/**
 * Get all feature flags for a tenant, merged with defaults.
 */
exports.getTenantFlags = async (tenantId) => {
  const settings = await TenantSettings.findAll({
    where: {
      tenantId,
      key: { [require('sequelize').Op.like]: 'feature_flag_%' },
    },
  });

  const overrides = {};
  settings.forEach((s) => {
    const key = s.key.replace('feature_flag_', '');
    overrides[key] = s.value === 'true' || s.value === true;
  });

  const result = {};
  for (const [key, def] of Object.entries(DEFAULT_FLAGS)) {
    result[key] = {
      enabled: overrides[key] !== undefined ? overrides[key] : def.defaultValue,
      category: def.category,
      description: def.description,
      defaultValue: def.defaultValue,
      tenantOverride: overrides[key] !== undefined,
    };
  }

  return result;
};

/**
 * Set a feature flag for a tenant (admin override).
 */
exports.setTenantFlag = async (tenantId, flagKey, value, updatedBy) => {
  if (!DEFAULT_FLAGS[flagKey]) {
    throw new AppError(400, `Unknown feature flag: ${flagKey}`);
  }

  const [setting, created] = await TenantSettings.upsert({
    tenantId,
    key: `feature_flag_${flagKey}`,
    value: value ? 'true' : 'false',
    updatedBy,
  });

  return {
    flagKey,
    enabled: value,
    created,
    setting,
  };
};

/**
 * Reset a feature flag to its plan default.
 */
exports.resetTenantFlag = async (tenantId, flagKey) => {
  const deleted = await TenantSettings.destroy({
    where: {
      tenantId,
      key: `feature_flag_${flagKey}`,
    },
  });

  return {
    flagKey,
    reset: deleted > 0,
    defaultValue: DEFAULT_FLAGS[flagKey]?.defaultValue ?? false,
  };
};

/**
 * Initialize default feature flags for a new tenant.
 */
exports.initializeTenantFlags = async (tenantId) => {
  const settings = [];
  for (const [key, def] of Object.entries(DEFAULT_FLAGS)) {
    if (def.defaultValue) {
      settings.push({
        tenantId,
        key: `feature_flag_${key}`,
        value: 'true',
      });
    }
  }

  /* istanbul ignore else -- DEFAULT_FLAGS is a hardcoded module constant with
     six `defaultValue: true` entries, so `settings` is never empty here; the
     guard is defensive against a future all-false default set. */
  if (settings.length > 0) {
    await TenantSettings.bulkCreate(settings, { ignoreDuplicates: true });
  }

  return exports.getTenantFlags(tenantId);
};

exports.FEATURE_FLAG_CATEGORIES = FEATURE_FLAG_CATEGORIES;
exports.DEFAULT_FLAGS = DEFAULT_FLAGS;
