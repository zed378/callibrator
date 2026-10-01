/**
 * Per-tenant feature flags: the catalogue of defaults, and each tenant's
 * override stored as a `feature_flag_<key>` TenantSettings row.
 *
 * P9-13 (ADR-087, Stage C leaves): converted from featureFlag.service.js with
 * no behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order); `initializeTenantFlags` calls
 * `getTenantFlags` through that object, as `exports.getTenantFlags` did, so a
 * spy on the module still intercepts it. `TenantSettings` is destructured from
 * the barrel once at load, as before. `Op` is a named import: the `.js`
 * required `sequelize` inside `getTenantFlags`, and both read the same `Op`
 * object at call time (sequelize is already loaded by the models barrel).
 */
import { Op } from "sequelize";
import type { Transaction } from "sequelize";

import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { actorChanges, auditEntryActor } from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { TenantSettings } = models;
const AppError = LoadedAppError;

type TenantSettingsRow = ModelInstance<"TenantSettings">;

interface FlagDefinition {
  category: string;
  defaultValue: boolean;
  description: string;
}

interface TenantFlagState {
  enabled: boolean;
  category: string;
  description: string;
  defaultValue: boolean;
  tenantOverride: boolean;
}

interface SetFlagResult {
  flagKey: string;
  enabled: unknown;
  created: boolean | null;
  setting: TenantSettingsRow;
}

interface ResetFlagResult {
  flagKey: string;
  reset: boolean;
  defaultValue: boolean;
}

const FEATURE_FLAG_CATEGORIES = {
  PLATFORM: "platform",
  CALIBRATION: "calibration",
  BILLING: "billing",
  COMPLIANCE: "compliance",
  AI: "ai",
  FIELD_SERVICE: "field_service",
  INTEGRATION: "integration",
};

// Looked up by a caller-supplied key, exactly as the `.js` object was: a plain
// object, so a key such as "toString" still reaches the prototype, as built.
const DEFAULT_FLAGS: Record<string, FlagDefinition> = {
  enable_iot: { category: FEATURE_FLAG_CATEGORIES.CALIBRATION, defaultValue: true, description: "Enable IoT sensor ingestion and predictive maintenance" },
  enable_ai_ocr: { category: FEATURE_FLAG_CATEGORIES.AI, defaultValue: true, description: "Enable AI-powered OCR for external certificates" },
  enable_rag: { category: FEATURE_FLAG_CATEGORIES.AI, defaultValue: true, description: "Enable RAG over tenant documents" },
  enable_scheduler: { category: FEATURE_FLAG_CATEGORIES.CALIBRATION, defaultValue: true, description: "Enable calibration scheduler and reminders" },
  enable_mfa: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: "Require MFA for all users" },
  enable_webauthn: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: "Enable WebAuthn/passkey login" },
  enable_scim: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: true, description: "Enable SCIM 2.0 provisioning" },
  enable_sandbox: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: "Enable sandbox tenant creation" },
  enable_metered_billing: { category: FEATURE_FLAG_CATEGORIES.BILLING, defaultValue: false, description: "Enable usage-based metered billing" },
  enable_customer_portal: { category: FEATURE_FLAG_CATEGORIES.FIELD_SERVICE, defaultValue: false, description: "Enable external customer portal" },
  enable_scheduling: { category: FEATURE_FLAG_CATEGORIES.FIELD_SERVICE, defaultValue: false, description: "Enable calendar/resource scheduling" },
  enable_qms_depth: { category: FEATURE_FLAG_CATEGORIES.COMPLIANCE, defaultValue: true, description: "Enable advanced QMS features (CAPA, SOP, training)" },
  enable_e_signature: { category: FEATURE_FLAG_CATEGORIES.COMPLIANCE, defaultValue: false, description: "Enable 21 CFR Part 11 e-signature workflow" },
  enable_data_residency: { category: FEATURE_FLAG_CATEGORIES.PLATFORM, defaultValue: false, description: "Enable tenant data residency routing" },
};

/**
 * A stored override reads as enabled for the text "true" — or, as built, a
 * boolean `true` (the column is TEXT, so the driver never returns one, but the
 * `.js` accepted it and so does this).
 */
const isTrue = (value: unknown): boolean => value === "true" || value === true;

/**
 * P6-11 (A-41 addendum) — a flag change is a platform operator changing ONE
 * tenant, so it is recorded as A-165 records one (admin.service
 * #auditPlatformActionOnTenant): a row under the PLATFORM tenant and a row
 * under the affected tenant, both inside the change's transaction, so a
 * rolled-back change leaves neither. The flag value is not a secret.
 *
 * @param transaction - the change's transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId - the tenant whose flag changed
 * @param changes - { operation, flagKey, before, after }
 */
const auditFlagChange = async (
  transaction: Transaction,
  actor: AuditActorInput | null | undefined,
  tenantId: TenantId,
  changes: Record<string, unknown>,
): Promise<void> => {
  const entry = {
    ...auditEntryActor(actor),
    action: "UPDATE" as const,
    resourceType: "Tenant",
    resourceId: tenantId,
    changes: { ...changes, ...actorChanges(actor) },
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId }, { transaction });
};

/** The stored override of one flag, or null (read inside the change's transaction). */
const storedValue = async (tenantId: TenantId, flagKey: string, transaction: Transaction): Promise<string | null> => {
  const row = await TenantSettings.findOne({ where: { tenantId, key: `feature_flag_${flagKey}` }, transaction });
  return row ? String(row.value) : null;
};

/**
 * Check if a feature flag is enabled for a tenant.
 *
 * Resolution order:
 * 1. TenantSettings override (tenant-specific)
 * 2. Plan default (from DEFAULT_FLAGS)
 * 3. Global default (false)
 */
const isEnabled = async (tenantId: TenantId, flagKey: string): Promise<boolean> => {
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
    return isTrue(setting.value);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- as built: DEFAULT_FLAGS is exported and mutable, so a JavaScript caller can store a non-boolean default; only `true` enables
  return flagDef.defaultValue === true;
};

/**
 * Get all feature flags for a tenant, merged with defaults.
 */
const getTenantFlags = async (tenantId: TenantId): Promise<Record<string, TenantFlagState>> => {
  const settings = await TenantSettings.findAll({
    where: {
      tenantId,
      key: { [Op.like]: "feature_flag_%" },
    },
  });

  const overrides: Record<string, boolean> = {};
  settings.forEach((s) => {
    const key = s.key.replace("feature_flag_", "");
    overrides[key] = isTrue(s.value);
  });

  const result: Record<string, TenantFlagState> = {};
  for (const [key, def] of Object.entries(DEFAULT_FLAGS)) {
    const override = overrides[key];
    result[key] = {
      // `override` is a boolean or undefined (never null), so `??` is the `.js` ternary
      enabled: override ?? def.defaultValue,
      category: def.category,
      description: def.description,
      defaultValue: def.defaultValue,
      tenantOverride: override !== undefined,
    };
  }

  return result;
};

/**
 * Set a feature flag for a tenant (admin override).
 */
const setTenantFlag = async (
  tenantId: TenantId,
  flagKey: string,
  value: unknown,
  updatedBy: UserId | null | undefined,
  actor: AuditActorInput | null = { userId: updatedBy ?? null },
): Promise<SetFlagResult> => {
  if (!DEFAULT_FLAGS[flagKey]) {
    throw new AppError(400, `Unknown feature flag: ${flagKey}`);
  }

  const stored = value ? "true" : "false";
  // P6-11: the override and its audit rows commit together.
  const [setting, created] = await db.transaction(async (transaction: Transaction) => {
    const before = await storedValue(tenantId, flagKey, transaction);
    const result = await TenantSettings.upsert(
      {
        tenantId,
        key: `feature_flag_${flagKey}`,
        value: stored,
        // @ts-expect-error -- as built: `updatedBy` is not a TenantSettings attribute, so Sequelize drops it on write, as it always has
        updatedBy,
      },
      { transaction },
    );
    await auditFlagChange(transaction, actor, tenantId, {
      operation: "FEATURE_FLAG_SET",
      flagKey,
      before,
      after: stored,
    });
    return result;
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
const resetTenantFlag = async (
  tenantId: TenantId,
  flagKey: string,
  actor: AuditActorInput | null = null,
): Promise<ResetFlagResult> => {
  // P6-11: the reset and its audit rows commit together. Resetting a flag that
  // has no override changes nothing and writes no row.
  const deleted = await db.transaction(async (transaction: Transaction) => {
    const before = await storedValue(tenantId, flagKey, transaction);
    const count = await TenantSettings.destroy({
      where: {
        tenantId,
        key: `feature_flag_${flagKey}`,
      },
      transaction,
    });
    if (count > 0) {
      await auditFlagChange(transaction, actor, tenantId, {
        operation: "FEATURE_FLAG_RESET",
        flagKey,
        before,
        after: null,
      });
    }
    return count;
  });

  return {
    flagKey,
    reset: deleted > 0,
    defaultValue: DEFAULT_FLAGS[flagKey]?.defaultValue ?? false,
  };
};

/**
 * Initialize default feature flags for a new tenant.
 *
 * P6-11: from the route (an `actor`), the defaults and their audit rows commit
 * together. The one caller without an actor is the development-only demo
 * seeder (migration.service#seedDemoTenant), which writes no audit row for any
 * of the demo data it creates; it keeps that behaviour here.
 */
const initializeTenantFlags = async (
  tenantId: TenantId,
  actor: AuditActorInput | null = null,
): Promise<Record<string, TenantFlagState>> => {
  const settings: { tenantId: TenantId; key: string; value: string }[] = [];
  for (const [key, def] of Object.entries(DEFAULT_FLAGS)) {
    if (def.defaultValue) {
      settings.push({
        tenantId,
        key: `feature_flag_${key}`,
        value: "true",
      });
    }
  }

  // A-32: no `settings.length > 0` guard — DEFAULT_FLAGS always yields rows,
  // and bulkCreate([]) is a no-op should that ever change.
  if (actor) {
    await db.transaction(async (transaction: Transaction) => {
      await TenantSettings.bulkCreate(settings, { ignoreDuplicates: true, transaction });
      await auditFlagChange(transaction, actor, tenantId, {
        operation: "FEATURE_FLAG_INITIALIZE",
        flagKeys: settings.map((row) => row.key.replace("feature_flag_", "")),
      });
    });
  } else {
    await TenantSettings.bulkCreate(settings, { ignoreDuplicates: true });
  }

  return service.getTenantFlags(tenantId);
};

const service = {
  isEnabled,
  getTenantFlags,
  setTenantFlag,
  resetTenantFlag,
  initializeTenantFlags,
  FEATURE_FLAG_CATEGORIES,
  DEFAULT_FLAGS,
};

export = service;
