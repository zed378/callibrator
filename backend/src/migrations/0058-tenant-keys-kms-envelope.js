"use strict";

/**
 * Tenant e-signature private keys move from AES-CBC under ENCRYPT_KEY to KMS
 * envelopes (S-08, P6-10; ADR-PENDING-data).
 *
 * WHAT WAS WRONG
 *
 * `tenant_keys.private_key` — the keys that sign 21 CFR Part 11 records — was
 * `ivHex:cipherHex`, AES-256-CBC under sha256(ENCRYPT_KEY): no MAC (the
 * ciphertext is malleable), no tenant binding (a row copied between tenants
 * decrypts), and a key outside the KMS with no key id, so it could not be
 * rotated at all. Every other secret already used kms.service.
 *
 * WHAT THIS DOES — one transaction, every row verified
 *
 * Each legacy row is decrypted (any of ENCRYPT_KEY / ENCRYPT_KEY_PREVIOUS;
 * the result must parse as a private key), re-encrypted as a v2 KMS envelope
 * under its OWN tenant id, written with an optimistic predicate, re-read, and
 * decrypted again to prove it holds the same key
 * (services/keyRotation.service.js#rewrapTarget). Soft-deleted keys included.
 * Any row that cannot be converted fails the migration, naming its id, and
 * the transaction leaves every row as it was.
 *
 * Needs the SAME ENCRYPT_KEY the rows were written under, and the KMS master
 * key the application runs with. A database with no legacy rows needs
 * neither beyond KMS_MASTER_KEY; after this migration ENCRYPT_KEY is only
 * read for a row restored from an older backup.
 *
 * `down` converts every envelope back to AES-CBC under ENCRYPT_KEY (the
 * pre-0058 code reads nothing else) — it refuses without ENCRYPT_KEY.
 *
 * No try/catch around the work. Verify with psql:
 *   SELECT count(*) FILTER (WHERE private_key LIKE 'v2:%') AS envelope,
 *          count(*) FILTER (WHERE private_key NOT LIKE 'v1:%' AND private_key NOT LIKE 'v2:%') AS legacy
 *     FROM tenant_keys;
 */

const kms = require("../services/kms.service");
const { wrapLegacy } = require("../services/signingKeyWrap.service");
const { rewrapTarget, TARGETS } = require("../services/keyRotation.service");

const TABLE = "tenant_keys";

const tableExists = async (sequelize) => {
  const [[{ present }]] = await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { replacements: { table: TABLE } },
  );
  return present;
};

module.exports = {
  TABLE,

  up: async ({ context }) => {
    const { sequelize } = context;
    if (!(await tableExists(sequelize))) {
      // db.sync() creates it empty; a new key is written as an envelope, so
      // an absent table has nothing to convert and nothing to miss.
      return;
    }
    const target = TARGETS.find((t) => t.table === TABLE);
    await sequelize.transaction(async () => {
      const report = await rewrapTarget({ sequelize, target });
      if (report.failed.length) {
        throw new Error(
          `0058: ${report.failed.length} tenant signing key(s) could not be moved to a KMS envelope ` +
            `(nothing was changed):\n  ${report.failed.map((f) => `${f.id}: ${f.error}`).join("\n  ")}\n` +
            "Set the ENCRYPT_KEY these keys were written under (ENCRYPT_KEY_PREVIOUS for older ones) and restart.",
        );
      }
      if (report.skipped) {
        throw new Error(`0058: ${report.skipped} row(s) changed while being converted; restart to retry.`);
      }
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    if (!(await tableExists(sequelize))) {
      return;
    }
    await sequelize.transaction(async () => {
      const rows = await sequelize.query(
        `SELECT id::text AS id, tenant_id::text AS tenant_id, private_key FROM ${TABLE}
          WHERE private_key LIKE 'v1:%' OR private_key LIKE 'v2:%'`,
        { type: "SELECT" },
      );
      for (const row of rows) {
        const legacy = wrapLegacy(kms.decryptData(row.tenant_id, row.private_key));
        await sequelize.query(
          `UPDATE ${TABLE} SET private_key = :legacy WHERE id::text = :id AND tenant_id::text = :tenantId`,
          { replacements: { legacy, id: row.id, tenantId: row.tenant_id } },
        );
      }
    });
  },
};
