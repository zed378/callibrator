/**
 * Tenant backups: `backup_path` becomes TEXT, and a completed backup written
 * before S-32 gets the `expires_at` it should have had (S-32; ADR-080).
 *
 * WHAT WAS WRONG
 *
 * - `tenant_backups.backup_path` was VARCHAR(255). The service copied the
 *   absolute file path into it, and a long `APP_STORAGE_PATH` failed the whole
 *   COMPLETED update with "value too long". The service stopped writing it
 *   (2026-09-24, S-32); readers still fall back to it for old rows, and the
 *   column stayed a 255-character trap for the next writer.
 * - The HTTP `createBackup` never stamped `expires_at`. The service now does
 *   (`retentionDays` -> TenantBackup.updateStatus), but every completed row
 *   taken over HTTP before that has NULL, and every reader of the column —
 *   the API, an operator in psql — sees "never expires".
 *
 * The status ENUM is NOT changed. `deleting`, `restoring` and `restored` were
 * values the service wrote and the ENUM never had; the service now expresses
 * those states with ENUM members (docs/DEVOPS/04-DATABASE-BACKUP.md, "The
 * state machine"), and tests/models/tenantBackup.status.s32.test.js keeps the
 * model's STATUS and its ENUM identical. Adding three values nothing writes
 * would be schema no code reads (ADR-080).
 *
 * WHAT THIS DOES — one transaction
 *
 * 1. `backup_path` -> TEXT, when it is not already (a fresh `db.sync()` builds
 *    it as TEXT from the model).
 * 2. `expires_at = created_at + retention_days days` for a COMPLETED row whose
 *    `expires_at` is NULL and whose `retention_days` is positive — the rule
 *    the pruner applies (scheduledBackup.service#effectiveExpiry) and the one
 *    the service stamps with. A row with no positive `retention_days` is LEFT
 *    NULL: the pruner's fallback is a runtime setting (BACKUP_RETENTION_DAYS),
 *    and the migration does not guess it.
 *
 * Idempotent: the type change is skipped when already TEXT, and the backfill
 * only matches rows whose expiry is still NULL.
 *
 * `down` restores VARCHAR(255) and refuses, changing nothing, while any
 * `backup_path` is longer than 255 characters. It leaves the backfilled
 * `expires_at`: it equals the expiry the pruner derived without it, so the
 * earlier code behaves the same with or without it.
 *
 * No try/catch. Verify with psql:
 *   \d tenant_backups   -- backup_path text
 *   SELECT count(*) FROM tenant_backups
 *    WHERE status = 'completed' AND expires_at IS NULL AND retention_days > 0;  -- 0
 */

import type { QueryInterface, Sequelize } from "sequelize";

const TABLE = "tenant_backups";
const COLUMN = "backup_path";
const LEGACY_LENGTH = 255;

const BACKFILL_SQL = `UPDATE ${TABLE}
   SET expires_at = created_at + retention_days * interval '1 day'
 WHERE status = 'completed'
   AND expires_at IS NULL
   AND retention_days > 0`;

/**
 * @param {object} sequelize
 * @returns {Promise<string|null>} backup_path's data_type, or null when the
 *   table (or the column) does not exist
 */
const pathType = async (sequelize: Sequelize): Promise<string | null> => {
  const rows = (await sequelize.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
    { type: "SELECT", replacements: { table: TABLE, column: COLUMN } },
  )) as { data_type: string }[];
  return rows.length ? (rows[0] as { data_type: string }).data_type : null;
};

export = {
  TABLE,
  COLUMN,
  BACKFILL_SQL,

  up: async ({ context }: { context: QueryInterface }): Promise<void> => {
    const { sequelize } = context;
    const type = await pathType(sequelize);
    if (type === null) {
      // db.sync() builds the table from the model: TEXT, and every completed
      // backup stamped with its expiry.
      return;
    }
    await sequelize.transaction(async () => {
      if (type !== "text") {
        await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} TYPE TEXT`);
      }
      await sequelize.query(BACKFILL_SQL);
    });
  },

  down: async ({ context }: { context: QueryInterface }): Promise<void> => {
    const { sequelize } = context;
    const type = await pathType(sequelize);
    if (type !== "text") {
      // Absent, or already the earlier VARCHAR: nothing to narrow.
      return;
    }
    await sequelize.transaction(async () => {
      const [[{ longest }]] = (await sequelize.query(
        `SELECT COALESCE(max(length(${COLUMN})), 0) AS longest FROM ${TABLE}`,
      )) as [[{ longest: number | string }], unknown];
      if (Number(longest) > LEGACY_LENGTH) {
        throw new Error(
          `0087 down refused: ${TABLE}.${COLUMN} holds a value of ${String(longest)} characters, ` +
            `longer than VARCHAR(${String(LEGACY_LENGTH)}) (nothing was changed).`,
        );
      }
      await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} TYPE VARCHAR(${String(LEGACY_LENGTH)})`);
    });
  },
};
