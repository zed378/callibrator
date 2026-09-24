"use strict";

/**
 * Adds `signature_workflows.requested_by` (A-170).
 *
 * A signature workflow recorded no requester, so the completion email had no
 * one to reach but the signers themselves: the person who asked for the
 * signatures was never told they were all collected. createSignatureWorkflow
 * now sets `requestedBy` from the authenticated actor, and completeWorkflow
 * emails the requester as well as the signers.
 *
 * The column: UUID, a foreign key to users(id), ON DELETE RESTRICT ON UPDATE
 * CASCADE — who requested a Part 11 signature is an attribution, and every
 * other attribution on the signature tables is RESTRICT (A-149, migration
 * 0037). Nullable: a workflow created before this deploy has no recorded
 * requester in its own row.
 *
 * Backfill: those rows are filled from the workflow's own CREATE audit row
 * (audit_logs: resource_type 'SignatureWorkflow', action 'CREATE',
 * resource_id = the workflow id, same tenant) where that row names a user
 * who still exists — createSignatureWorkflow has written that row, with the
 * actor, inside the creating transaction since A-104. A workflow with no such
 * row keeps NULL: its requester is not known, and no email goes to one.
 * The backfill reads audit_logs; it never writes it.
 *
 * The SignatureWorkflow model declares the column (underscored: true);
 * tests/migrations/0039-*.test.js asserts the name equals the model's own
 * `field`. On a FRESH database sync() has already created it from the model
 * and the add steps are no-ops.
 *
 * No blanket try/catch: a failure must fail the migration, not be recorded as
 * applied (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   \d signature_workflows   -- requested_by uuid, the FK below, the index
 *
 * Idempotent + reversible.
 */
const TABLE = "signature_workflows";
const COLUMN = "requested_by";
const INDEX = "signature_workflows_requested_by";
const CONSTRAINT = "signature_workflows_requested_by_fkey";

/** @param {object} DataTypes */
const columnSpec = (DataTypes) => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: "users", key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/**
 * Fill requested_by from each workflow's earliest CREATE audit row. Tenant
 * predicate explicit (raw SQL bypasses the tenant hooks): the audit row must
 * be in the workflow's own tenant.
 */
const BACKFILL_SQL = `
UPDATE signature_workflows AS w
   SET requested_by = src.user_id
  FROM (
    SELECT DISTINCT ON (a.resource_id, a.tenant_id) a.resource_id, a.tenant_id, a.user_id
      FROM audit_logs AS a
     WHERE a.resource_type = 'SignatureWorkflow'
       AND a.action = 'CREATE'
       AND a.user_id IS NOT NULL
     ORDER BY a.resource_id, a.tenant_id, a.created_at ASC
  ) AS src
 WHERE w.requested_by IS NULL
   AND src.resource_id = w.id::text
   AND src.tenant_id = w.tenant_id
   AND EXISTS (SELECT 1 FROM users AS u WHERE u.id = src.user_id)
`;

/**
 * Only "this table doesn't exist yet" is a reason to skip. Anything else is a
 * real failure and must surface.
 */
const describeOrSkip = async (queryInterface) => {
  try {
    return await queryInterface.describeTable(TABLE);
  } catch (err) {
    if (/no description found|does not exist/i.test(err.message || "")) {
      return null; // table not present yet — db.sync() will create it whole
    }
    throw err;
  }
};

const hasIndex = async (queryInterface) => {
  const indexes = await queryInterface.showIndex(TABLE);
  return indexes.some((index) => index.name === INDEX);
};

module.exports = {
  TABLE,
  COLUMN,
  INDEX,
  CONSTRAINT,
  BACKFILL_SQL,
  columnSpec,

  up: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    const DataTypes = context.sequelize.Sequelize.DataTypes;

    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, columnSpec(DataTypes));
    }
    if (!(await hasIndex(context))) {
      await context.addIndex(TABLE, [COLUMN], { name: INDEX });
    }
    // Only rows still NULL are touched, so a re-run changes nothing.
    await context.sequelize.query(BACKFILL_SQL);
  },

  // Rolling back drops who requested every workflow — the pre-A-170 state;
  // for rows created since the deploy it is recoverable only from their
  // CREATE audit rows (the same source the backfill reads).
  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    if (await hasIndex(context)) {
      await context.removeIndex(TABLE, INDEX);
    }
    if (desc[COLUMN]) {
      // Dropping the column drops its foreign key with it.
      await context.removeColumn(TABLE, COLUMN);
    }
  },
};
