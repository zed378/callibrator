/**
 * P7-05 (ADR-078) — refuse to boot when the database holds secrets the
 * configured KMS master keys cannot open.
 *
 * A restore that brings back the database without the KMS_MASTER_KEY it was
 * written under used to START CLEANLY: /health answered 200, users signed in,
 * lists rendered. Every wrapped value — the tenant e-signature private keys,
 * webhook secrets, SSO/OIDC/Stripe/storage/AI credentials in tenant_settings —
 * failed only when first used, as a 500 inside a request, days later. That is
 * the "starts cleanly and is permanently broken" restore that
 * docs/DEVOPS/04-DATABASE-BACKUP.md warns about, observed in the P7-04 drill.
 *
 * What is checked, at every boot, for each column keys:rotate re-wraps
 * (keyRotation.service TARGETS):
 *
 *  - every key id a `v2:<keyId>:…` envelope names is in the ring
 *    (KMS_MASTER_KEY + KMS_MASTER_KEY_PREVIOUS). A key id is a fingerprint of
 *    the key itself (utils/keyring.util.js), so "the id is configured" is
 *    "the key is configured" — no decryption is needed, and nothing secret is
 *    read;
 *  - a `v1:` envelope names no key, so one of them (per column) is decrypted
 *    as a sample.
 *
 * Soft-deleted rows are included: they hold ciphertext too, and keys:rotate
 * visits them. Deliberately raw SQL across ALL tenants: this is a boot check,
 * not a request, and it reads key ids and counts — never a value, except the
 * single v1 sample, which is decrypted with its own tenant id and discarded.
 *
 * Not wrapped in a catch. `KMS_VERIFY=warn` is the one way past a failure: it
 * logs every problem at error level and continues. It exists for the recovery
 * in which the key is known to be lost and the affected secrets will be
 * re-entered (docs/SECURITY/14-SECRET-ESCROW.md), not for a steady state.
 */
const kms = require("../services/kms.service");
const { TARGETS, aadOf } = require("../services/keyRotation.service");

const TAG = "[kms-verify]";

/**
 * @param {object} sequelize
 * @returns {Promise<{problems: string[], envelopes: number}>}
 */
const verifyKmsKeys = async (sequelize) => {
  const { currentKeyId, previousKeyIds } = kms.keyInfo();
  const ring = new Set([currentKeyId, ...previousKeyIds]);
  const problems = [];
  let envelopes = 0;

  for (const target of TARGETS) {
    const { table, column } = target;
    const byKey = await sequelize.query(
      `SELECT split_part(${column}, ':', 2) AS key_id, COUNT(*)::int AS n
         FROM ${table} WHERE ${column} LIKE 'v2:%' GROUP BY 1 ORDER BY 1`,
      { type: "SELECT" },
    );
    for (const { key_id: keyId, n } of byKey) {
      envelopes += n;
      if (!ring.has(keyId)) {
        problems.push(
          `${table}.${column}: ${n} value(s) wrapped under KMS master key ${keyId}, which is not configured`,
        );
      }
    }

    const [v1] = await sequelize.query(
      `SELECT COUNT(*)::int AS n, MIN(id::text) AS id FROM ${table} WHERE ${column} LIKE 'v1:%'`,
      { type: "SELECT" },
    );
    if (v1 && v1.n > 0) {
      envelopes += v1.n;
      const [sample] = await sequelize.query(
        `SELECT id::text AS id, tenant_id::text AS tenant_id, ${column} AS value FROM ${table} WHERE id::text = :id`,
        { type: "SELECT", replacements: { id: v1.id } },
      );
      try {
        // S-20: the AAD is the tenant id, or what the target derives (users' MFA seeds: the user id).
        kms.decryptData(aadOf(target, sample), sample.value);
      } catch {
        problems.push(
          `${table}.${column}: ${v1.n} v1 value(s); the sample (id ${v1.id}) does not decrypt under any configured KMS master key`,
        );
      }
    }
  }
  return { problems, envelopes };
};

/**
 * Verify, and refuse the boot on a problem unless `mode` is "warn".
 *
 * @param {object} options
 * @param {object} options.sequelize
 * @param {object} options.logger
 * @param {string} [options.mode] - process.env.KMS_VERIFY; "warn" logs and continues
 * @returns {Promise<{problems: string[], envelopes: number}>}
 */
const assertKmsKeysConfigured = async ({ sequelize, logger, mode = process.env.KMS_VERIFY }) => {
  const result = await verifyKmsKeys(sequelize);
  if (result.problems.length === 0) {
    logger.info(`${TAG} OK: ${result.envelopes} stored envelope(s), every one under a configured master key`);
    return result;
  }
  for (const problem of result.problems) {
    logger.error(`${TAG} UNREADABLE: ${problem}`);
  }
  const summary =
    `${TAG} FAILED: the database holds secrets the configured KMS master keys cannot open. ` +
    "Restore the KMS_MASTER_KEY this database was written under (or add it to KMS_MASTER_KEY_PREVIOUS), then restart. " +
    "See docs/SECURITY/14-SECRET-ESCROW.md.";
  if (mode === "warn") {
    logger.error(`${summary} Continuing ONLY because KMS_VERIFY=warn: every value listed is unreadable.`);
    return result;
  }
  throw new Error(`${summary}\n  ${result.problems.join("\n  ")}`);
};

module.exports = { verifyKmsKeys, assertKmsKeysConfigured, TAG };
