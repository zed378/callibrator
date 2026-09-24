/**
 * P6-10 / S-08 — re-wrap every stored secret under the CURRENT KMS master key.
 *
 * Rotation (docs/SECURITY/13-KEY-ROTATION.md):
 *   1. deploy with KMS_MASTER_KEY=<new> and KMS_MASTER_KEY_PREVIOUS=<old> —
 *      every row still reads, every new row is written under <new>;
 *   2. run this (npm run keys:rotate) until it reports nothing left;
 *   3. deploy without KMS_MASTER_KEY_PREVIOUS.
 * A step-2 failure changes nothing it has not verified, and step 3 is not
 * taken until step 2 reports zero — that is the rollback: keep (or restore)
 * the previous key in the ring and every row still reads.
 *
 * RESUMABLE: it only touches rows that still need it (a v1 envelope, a v2
 * envelope naming another key, or a legacy AES-CBC signing key), so a second
 * run after an interruption picks up where the first stopped. Each row is
 * written with an optimistic predicate (`AND <column> = <what was read>`), so
 * a row the application rewrote meanwhile is skipped, not clobbered, and is
 * RE-READ after the write and decrypted to prove the new value holds the same
 * secret.
 *
 * Deliberately raw SQL across ALL tenants — an operator task, not a request:
 * every UPDATE names the row's id AND its tenant_id, and the tenant id is the
 * AAD the value is decrypted and re-encrypted under. Soft-deleted rows are
 * included: they hold ciphertext under the old key too.
 */
const kms = require("./kms.service");
const signingKeyWrap = require("./signingKeyWrap.service");

/**
 * Where envelopes live. `legacy` names a converter for a non-envelope value
 * that must become one (the pre-0058 signing keys); without it a
 * non-envelope value (plaintext of a non-secret setting) is left alone.
 */
const TARGETS = Object.freeze([
  Object.freeze({ table: "tenant_settings", column: "value" }),
  Object.freeze({ table: "webhooks", column: "secret" }),
  Object.freeze({ table: "tenant_keys", column: "private_key", legacy: signingKeyWrap }),
]);

const DEFAULT_BATCH = 200;

/**
 * @param {object} target - a TARGETS entry
 * @param {string|null} value - the stored value
 * @returns {"rewrap"|"convert"|null} what the row needs
 */
const workFor = (target, value) => {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  if (kms.needsRewrap(value)) {
    return "rewrap";
  }
  if (target.legacy && target.legacy.isLegacy(value)) {
    return "convert";
  }
  return null;
};

/**
 * @param {object} target
 * @param {string} tenantId
 * @param {string} value
 * @returns {string} the plaintext the stored value holds
 */
const plaintextOf = (target, tenantId, value) =>
  target.legacy && target.legacy.isLegacy(value)
    ? target.legacy.unwrapPrivateKey(tenantId, value)
    : kms.decryptData(tenantId, value);

/**
 * Re-wrap one target's rows.
 *
 * @param {object} options
 * @param {object} options.sequelize
 * @param {object} options.target - a TARGETS entry
 * @param {boolean} [options.dryRun] - count only, write nothing
 * @param {number} [options.batchSize]
 * @returns {Promise<{table: string, scanned: number, rewrapped: number, converted: number, skipped: number, failed: Array<{id: string, error: string}>}>}
 */
const rewrapTarget = async ({ sequelize, target, dryRun = false, batchSize = DEFAULT_BATCH }) => {
  const { table, column } = target;
  const report = { table, scanned: 0, rewrapped: 0, converted: 0, skipped: 0, failed: [] };
  let cursor = null;

  for (;;) {
    const rows = await sequelize.query(
      `SELECT id::text AS id, tenant_id::text AS tenant_id, ${column} AS value FROM ${table}
        ${cursor === null ? "" : "WHERE id::text > :cursor"}
        ORDER BY id::text LIMIT :limit`,
      { type: "SELECT", replacements: { cursor, limit: batchSize } },
    );
    if (rows.length === 0) {
      break;
    }
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      report.scanned += 1;
      const work = workFor(target, row.value);
      if (work === null) {
        continue;
      }
      try {
        const plaintext = plaintextOf(target, row.tenant_id, row.value);
        if (dryRun) {
          report[work === "rewrap" ? "rewrapped" : "converted"] += 1;
          continue;
        }
        const next = kms.encryptData(row.tenant_id, plaintext);
        const [, affected] = await sequelize.query(
          `UPDATE ${table} SET ${column} = :next
            WHERE id::text = :id AND tenant_id::text = :tenantId AND ${column} = :previous`,
          { replacements: { next, id: row.id, tenantId: row.tenant_id, previous: row.value } },
        );
        if (!(affected && affected.rowCount === 1)) {
          report.skipped += 1; // rewritten by the application meanwhile — the next run revisits it
          continue;
        }
        const [reread] = await sequelize.query(
          `SELECT ${column} AS value FROM ${table} WHERE id::text = :id AND tenant_id::text = :tenantId`,
          { type: "SELECT", replacements: { id: row.id, tenantId: row.tenant_id } },
        );
        if (kms.decryptData(row.tenant_id, reread.value) !== plaintext) {
          throw new Error("the re-read value does not decrypt to the original secret");
        }
        report[work === "rewrap" ? "rewrapped" : "converted"] += 1;
      } catch (err) {
        report.failed.push({ id: row.id, error: err.message });
      }
    }
  }
  return report;
};

/**
 * Re-wrap every target.
 *
 * @param {object} options
 * @param {object} options.sequelize
 * @param {boolean} [options.dryRun]
 * @param {number} [options.batchSize]
 * @param {string[]} [options.tables] - limit to these tables
 * @returns {Promise<{keyInfo: object, reports: object[], failed: number}>}
 */
const rewrapAll = async ({ sequelize, dryRun = false, batchSize = DEFAULT_BATCH, tables } = {}) => {
  const reports = [];
  for (const target of TARGETS) {
    if (tables && !tables.includes(target.table)) {
      continue;
    }
    reports.push(await rewrapTarget({ sequelize, target, dryRun, batchSize }));
  }
  return {
    keyInfo: kms.keyInfo(),
    reports,
    failed: reports.reduce((n, r) => n + r.failed.length, 0),
  };
};

module.exports = { rewrapAll, rewrapTarget, TARGETS, workFor };
