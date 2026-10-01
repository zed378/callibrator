/**
 * certificates.submitted_by — who submitted a certificate for approval
 * (ADR-101, separation of duties).
 *
 * WHAT WAS WRONG
 *
 * Nothing stopped the user who drafted or submitted a certificate from
 * approving it. ISO/IEC 17025 §7.8.1.2 and 21 CFR Part 11 §11.10(g) read the
 * approval as an independent review; a self-approval is no review. The
 * certificate recorded its author (`created_by`) but not its submitter, so the
 * rule could not be checked.
 *
 * WHAT THIS DOES
 *
 * Adds `submitted_by` (UUID, nullable, FK users ON DELETE RESTRICT, as
 * `approved_by` / `signed_by`), then back-fills it for certificates already
 * past `draft` from the latest SUBMIT_FOR_APPROVAL audit row of each one
 * (certificate.service#submitCertificateForApproval writes `changes.operation`
 * = "SUBMIT_FOR_APPROVAL" with the submitter as `user_id`). A certificate with
 * no such row keeps NULL; the approval guard then falls back to `created_by`.
 *
 * The back-fill reads audit_logs and writes certificates only; it runs as the
 * owner, bypassing no tenant rule (the audit row and the certificate share the
 * certificate's id, and the predicate `a.tenant_id = c.tenant_id` keeps it in
 * the certificate's own tenant).
 *
 * No try/catch: a failure propagates and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   \d certificates                      -- submitted_by uuid, its FK, index certificates_submitted_by
 *   SELECT count(*) FROM certificates WHERE status <> 'draft' AND submitted_by IS NULL;
 *
 * Idempotent + reversible.
 */
import type { DataTypes, QueryInterface } from "sequelize";

type Context = QueryInterface & { sequelize: { Sequelize: { DataTypes: typeof DataTypes } } };

const TABLE = "certificates";
const COLUMN = "submitted_by";
/** D-20: every foreign key has a leading index (0067). The Sequelize default name. */
const INDEX = "certificates_submitted_by";

const BACKFILL_SQL = `
UPDATE certificates c
   SET submitted_by = s.user_id
  FROM (
    SELECT DISTINCT ON (a.resource_id) a.resource_id, a.user_id, a.tenant_id
      FROM audit_logs a
     WHERE a.resource_type = 'Certificate'
       AND a.changes ->> 'operation' = 'SUBMIT_FOR_APPROVAL'
       AND a.user_id IS NOT NULL
     ORDER BY a.resource_id, a.created_at DESC
  ) s
 WHERE s.resource_id::text = c.id::text
   AND s.tenant_id = c.tenant_id
   AND c.submitted_by IS NULL
   AND c.status <> 'draft'
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)`;

const up = async ({ context }: { context: Context }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  if (!desc[COLUMN]) {
    await context.addColumn(TABLE, COLUMN, {
      type: context.sequelize.Sequelize.DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    });
  }
  await context.sequelize.query(`CREATE INDEX IF NOT EXISTS ${INDEX} ON ${TABLE} (${COLUMN})`);
  await context.sequelize.query(BACKFILL_SQL);
};

const down = async ({ context }: { context: Context }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  if (desc[COLUMN]) {
    await context.removeColumn(TABLE, COLUMN);
  }
};

export = { TABLE, COLUMN, INDEX, BACKFILL_SQL, up, down };
