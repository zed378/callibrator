/**
 * P10-16 (ADR-099) — `users.password_one_time`: the password signs in ONCE.
 *
 * Set only by the bootstrap of the first super admin and by the recovery CLI
 * (services/bootstrapCredential.service.ts). Its first successful sign-in
 * clears it and expires the password in the same conditional UPDATE; the User
 * model's beforeSave hook clears it whenever the password changes.
 *
 * NOT NULL DEFAULT false: every existing account is not one-time, which is
 * what it was. No backfill — the boot step that retires the old public
 * default (bootstrapCredential#retireKnownDefaultPassword) is what moves a
 * super admin still on it to a one-time password, with an audit row, and a
 * migration must not write a file.
 *
 * No try/catch (CLAUDE.md): a missing `users` table throws and the migration
 * is not recorded as applied. Verify with psql, not the log:
 *   \d users   -- password_one_time | boolean | not null | false
 *
 * Idempotent + reversible.
 */
import { DataTypes, type QueryInterface } from "sequelize";

const TABLE = "users";
const COLUMN = "password_one_time";

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  if (!desc[COLUMN]) {
    await context.addColumn(TABLE, COLUMN, {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const desc = await context.describeTable(TABLE);
  if (desc[COLUMN]) {
    await context.removeColumn(TABLE, COLUMN);
  }
};

export = { TABLE, COLUMN, up, down };
