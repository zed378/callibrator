/**
 * A retired calibration device stays retired, as a DATABASE rule (Q-02,
 * ADR-084).
 *
 * WHAT WAS WRONG
 *
 * `retired` was terminal by convention only. `PUT /calibration-devices/:id`
 * accepted `{ status: "active" }` on a retired device and wrote it with an
 * ordinary UPDATE audit row, and nothing in the database refused it. A device
 * whose retirement a calibration lab relied on (ISO 17025 §6.4: equipment
 * taken out of service is marked and kept out of use) could be put back into
 * service by any user holding calibration write, with nothing recording that
 * the retirement had been reversed rather than edited.
 *
 * WHAT THIS DOES
 *
 * One trigger function and one BEFORE UPDATE OF status trigger on
 * calibration_devices. It refuses an UPDATE that moves `status` away from
 * 'retired' — for every role, the owner included — UNLESS the transaction
 * has named that very device in the transaction-local setting
 * `callibrator.reinstate_device`. Only the audited reinstatement
 * (services/calibrationDeviceReinstate.service.js) sets it, with
 * `set_config(..., true)`, in the same transaction as the UPDATE and its audit
 * row. So the one way back is the act that records a reason, and every other
 * write path — the edit route, a script, a hand-written UPDATE — is refused.
 *
 * What it is NOT: a defence against someone who can run SQL and chooses to set
 * the variable. It stops a retirement being undone by accident or through the
 * ordinary edit path; the audit trail is what makes the deliberate act visible.
 *
 * `OF status`: the trigger fires only when an UPDATE names the column, so
 * editing a retired device's remarks or location is untouched. Retiring a
 * device, and re-saving `retired`, are allowed.
 *
 * SQLSTATE 23514 (check_violation): the service maps it to a 409 with a state
 * explanation, for the race where the device was retired between its read and
 * the write.
 *
 * On a FRESH database db.sync() creates the table and this migration adds the
 * trigger. It throws — never skips — when the table is absent: a skip would be
 * recorded as applied with no trigger (PR-5). No try/catch (CLAUDE.md).
 * The trigger is in schemaVerify's EXPECTED_OBJECTS, so a boot without it fails.
 *
 * Verify with psql, not the log:
 *   SELECT tgname FROM pg_trigger
 *    WHERE tgrelid = 'calibration_devices'::regclass AND NOT tgisinternal;
 *   UPDATE calibration_devices SET status = 'active' WHERE status = 'retired';
 *     -- ERROR: ... retirement is terminal
 */

import type { QueryInterface } from "sequelize";

const TABLE = "calibration_devices";
const FUNCTION_NAME = "calibration_devices_retired_terminal";
const TRIGGER_NAME = "calibration_devices_retired_terminal";
const REINSTATE_SETTING = "callibrator.reinstate_device";
const LOCK_TIMEOUT = "10s";

const createFunctionSql = (): string => `
CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status::text = 'retired'
     AND NEW.status::text IS DISTINCT FROM 'retired'
     AND COALESCE(current_setting('${REINSTATE_SETTING}', true), '') <> OLD.id::text THEN
    RAISE EXCEPTION
      'calibration device % is retired, and retirement is terminal (ADR-084); only an audited reinstatement may change its status',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;`;

export = {
  TABLE,
  FUNCTION_NAME,
  TRIGGER_NAME,
  REINSTATE_SETTING,

  up: async ({ context }: { context: QueryInterface }): Promise<void> => {
    const sequelize = context.sequelize;
    const [[exists]] = (await sequelize.query("SELECT to_regclass(:table) AS reg", {
      replacements: { table: TABLE },
    })) as [({ reg: string | null } | undefined)[], unknown];
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
    if (!exists || !exists.reg) {
      throw new Error(`0089: table ${TABLE} does not exist; refusing to record the trigger as applied`);
    }

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(createFunctionSql(), { transaction });
      await sequelize.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${TABLE}`, { transaction });
      await sequelize.query(
        `CREATE TRIGGER ${TRIGGER_NAME} BEFORE UPDATE OF status ON ${TABLE}
           FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()`,
        { transaction },
      );
    });
  },

  down: async ({ context }: { context: QueryInterface }): Promise<void> => {
    const sequelize = context.sequelize;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${TABLE}`, { transaction });
      await sequelize.query(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`, { transaction });
    });
  },
};
