/**
 * A-150 — take tenant secrets out of `tenants.settings`, and encrypt the ones
 * stored in plaintext in `tenant_settings`.
 *
 * Until A-150 `tenant.service#updateTenantSettings` re-read every
 * `tenant_settings` row — which the model's afterFind hook DECRYPTS — and
 * copied the whole map into the `tenants.settings` JSONB column. The KMS
 * envelope on `oidc_client_secret`, `stripe_secret_key`, `storage_credentials`
 * and the rest was therefore undone on the very row that every tenant API
 * returns, caches in Redis and (before A-139) exported in backups. The service
 * no longer writes that copy. This migration cleans what it already wrote:
 *
 *   1. `tenants.settings`: remove every key `isRedactedSettingKey` names (a
 *      secret, or an `oidc_rp_*` client record holding a secret's hash). Every
 *      other key — the display settings and the super admin's feature flags
 *      (admin.service#updateTenantFlags) — is kept as it is.
 *   2. `tenant_settings`: encrypt every value whose key `isSecretSettingKey`
 *      names and which is not already a `v1:` envelope, under its OWN tenant
 *      id. A-150 widened the secret set (`ai_api_key`, `smtp_password`, and any
 *      key named like a credential), so rows written before it are plaintext.
 *   3. Re-read both, and throw if a redacted key or a plaintext secret remains.
 *
 * The secret VALUES do not change, so nothing that uses them breaks. Values
 * that sat in plaintext in `tenants.settings` — and in every backup, replica
 * and Redis entry taken since — must be treated as disclosed: ROTATE them.
 * A migration cannot do that for a third party's key.
 *
 * Raw SQL, deliberately across all tenants: a maintenance pass over whole
 * tables, which the tenant hooks do not see. Every UPDATE carries the row's
 * tenant id and its previous value, so a row changed concurrently is counted
 * as a failure rather than overwritten.
 *
 * Needs the SAME `KMS_MASTER_KEY` as the running application.
 *
 * Idempotent: a second run finds nothing to do. `down` is a no-op — putting
 * plaintext secrets back is never the way to undo anything.
 *
 * No blanket try/catch (CLAUDE.md): a migration that swallows its errors is
 * recorded as applied while having done nothing. Verify with
 *   SELECT count(*) FROM tenants t, jsonb_object_keys(t.settings) k
 *    WHERE k ~* '(secret|passw(or)?d|passphrase|api_?key|private_?key|access_?key|token|credential)'
 *       OR k IN ('oidc_client_secret','stripe_secret_key','webhook_signing_secret',
 *                'storage_credentials','ai_api_key','smtp_password')
 *       OR k LIKE 'oidc_rp_%';
 * — it must be 0. The migration log is not evidence.
 *
 * A-178: `sso_idp_cert` (the IdP's PUBLIC certificate) is NOT a secret. This
 * migration leaves it in `tenants.settings` and does not encrypt it in
 * `tenant_settings`; a copy already enveloped by the pre-A-178 model is left
 * as it is — the model still decrypts an envelope under that key on read.
 */
const { QueryTypes } = require("sequelize");
const {
  isSecretSettingKey,
  isRedactedSettingKey,
} = require("../constants/tenantSecretSettings");

const NAME = "0035-tenant-settings-secrets";

/**
 * @param {import("sequelize").QueryInterface} queryInterface - query interface
 * @returns {Promise<Set<string>>} the lower-cased table names
 */
async function tableNames(queryInterface) {
  const tables = await queryInterface.showAllTables();
  return new Set(
    tables.map((t) => (typeof t === "object" ? t.tableName : t).toLowerCase()),
  );
}

/**
 * `settings` as an object, whether the driver returned JSONB parsed or not.
 * @param {*} value - the column value
 * @returns {object|null} the object, or null when it is not one
 */
function asObject(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

/**
 * @param {object} settings - a tenants.settings object
 * @returns {string[]} the keys that must not be there
 */
const redactedKeysIn = (settings) => Object.keys(settings).filter(isRedactedSettingKey);

/**
 * Step 1 — remove redacted keys from `tenants.settings`.
 * @param {import("sequelize").Sequelize} sequelize - the instance
 * @returns {Promise<void>} resolves when every row is scrubbed
 */
async function scrubTenantSettings(sequelize) {
  await sequelize.transaction(async (transaction) => {
    const rows = await sequelize.query(
      "SELECT id, settings FROM tenants WHERE settings IS NOT NULL",
      { type: QueryTypes.SELECT, transaction },
    );
    const failed = [];
    for (const row of rows) {
      const settings = asObject(row.settings);
      if (!settings || redactedKeysIn(settings).length === 0) {
        continue;
      }
      const kept = Object.fromEntries(
        Object.entries(settings).filter(([key]) => !isRedactedSettingKey(key)),
      );
      const [, meta] = await sequelize.query(
        `UPDATE tenants
            SET settings = CAST(:settings AS JSONB)
          WHERE id = :id AND settings = CAST(:previous AS JSONB)`,
        {
          replacements: {
            settings: JSON.stringify(kept),
            id: row.id,
            previous: JSON.stringify(settings),
          },
          transaction,
        },
      );
      if (!meta || meta.rowCount !== 1) {
        failed.push(row.id);
      }
    }
    if (failed.length) {
      throw new Error(`${NAME}: ${failed.length} tenant row(s) not scrubbed: ${failed.join(", ")}`);
    }
  });
}

/**
 * Step 2 — encrypt plaintext secret values in `tenant_settings`.
 * @param {import("sequelize").Sequelize} sequelize - the instance
 * @returns {Promise<void>} resolves when every secret row is an envelope
 */
async function encryptPlaintextSecrets(sequelize) {
  const { encryptData } = require("../services/kms.service");
  await sequelize.transaction(async (transaction) => {
    const rows = await sequelize.query(
      `SELECT id, tenant_id, key, value FROM tenant_settings
        WHERE value IS NOT NULL AND value <> '' AND value NOT LIKE 'v1:%' AND value NOT LIKE 'v2:%'`,
      { type: QueryTypes.SELECT, transaction },
    );
    const failed = [];
    for (const row of rows.filter((r) => isSecretSettingKey(r.key))) {
      const [, meta] = await sequelize.query(
        `UPDATE tenant_settings
            SET value = :value
          WHERE id = :id AND tenant_id = :tenantId AND value = :previous`,
        {
          replacements: {
            value: encryptData(row.tenant_id, row.value),
            id: row.id,
            tenantId: row.tenant_id,
            previous: row.value,
          },
          transaction,
        },
      );
      if (!meta || meta.rowCount !== 1) {
        failed.push(row.id);
      }
    }
    if (failed.length) {
      throw new Error(`${NAME}: ${failed.length} secret setting(s) not encrypted: ${failed.join(", ")}`);
    }
  });
}

/**
 * Step 3 — re-read both tables; throw if anything is left.
 * @param {import("sequelize").Sequelize} sequelize - the instance
 * @param {Set<string>} tables - the tables that exist
 * @returns {Promise<void>} resolves when nothing is left
 */
async function verify(sequelize, tables) {
  if (tables.has("tenants")) {
    const rows = await sequelize.query(
      "SELECT id, settings FROM tenants WHERE settings IS NOT NULL",
      { type: QueryTypes.SELECT },
    );
    const left = rows.filter((r) => {
      const s = asObject(r.settings);
      return s && redactedKeysIn(s).length > 0;
    });
    if (left.length) {
      throw new Error(`${NAME}: ${left.length} tenant row(s) still hold a secret in settings`);
    }
  }
  if (tables.has("tenant_settings")) {
    const rows = await sequelize.query(
      `SELECT key FROM tenant_settings
        WHERE value IS NOT NULL AND value <> '' AND value NOT LIKE 'v1:%' AND value NOT LIKE 'v2:%'`,
      { type: QueryTypes.SELECT },
    );
    const left = rows.filter((r) => isSecretSettingKey(r.key));
    if (left.length) {
      throw new Error(`${NAME}: ${left.length} secret setting(s) remain in plaintext`);
    }
  }
}

module.exports = {
  async up({ context }) {
    const queryInterface = context.queryInterface || context;
    const { sequelize } = queryInterface;
    const tables = await tableNames(queryInterface);

    if (tables.has("tenants")) {
      await scrubTenantSettings(sequelize);
    }
    if (tables.has("tenant_settings")) {
      await encryptPlaintextSecrets(sequelize);
    }
    await verify(sequelize, tables);
  },

  /**
   * Deliberately nothing. Restoring plaintext secrets into `tenants.settings`
   * would recreate the defect; the encrypted values read back unchanged
   * through the model, so there is nothing to reverse.
   * @returns {Promise<void>} resolves immediately
   */
  async down() {},
};
