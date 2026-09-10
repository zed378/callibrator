"use strict";

/**
 * Adds the WebAuthn credential columns to users.
 *
 * webauthn.service.js has always written these fields, but they existed on no
 * model and in no migration — Sequelize silently drops unknown attributes on
 * update(), so registration persisted nothing and every subsequent login threw
 * "WebAuthn not enabled for this user". This makes the module functional.
 *
 * users pre-dates the model-driven db.sync() for altered columns, so the
 * additions are done here explicitly.
 *
 * Idempotent + reversible.
 */
const TABLE = "users";

// Model attribute -> underscored column name (the model uses underscored: true).
const COLUMNS = {
  webauthn_enabled: (DataTypes) => ({
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  }),
  webauthn_credential_id: (DataTypes) => ({
    type: DataTypes.STRING(255),
    allowNull: true,
  }),
  webauthn_public_key: (DataTypes) => ({
    type: DataTypes.TEXT,
    allowNull: true,
  }),
  webauthn_sign_count: (DataTypes) => ({
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  }),
};

/**
 * Only "this table doesn't exist yet" is a reason to skip. Anything else is a
 * real failure and must surface: a blanket `catch { return }` here previously
 * swallowed a TypeError and let Umzug record this migration as applied while
 * it had done nothing.
 */
const describeOrSkip = async (queryInterface) => {
  try {
    return await queryInterface.describeTable(TABLE);
  } catch (err) {
    if (/no description found|does not exist|relation .* does not exist/i.test(err.message || "")) {
      return null; // table not present yet
    }
    throw err;
  }
};

module.exports = {
  up: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    const DataTypes = context.sequelize.Sequelize.DataTypes;

    for (const [column, spec] of Object.entries(COLUMNS)) {
      if (!desc[column]) {
        await context.addColumn(TABLE, column, spec(DataTypes));
      }
    }

    // Look-ups are always "find the user owning this credential id".
    try {
      await context.addIndex(TABLE, ["webauthn_credential_id"], {
        name: "users_webauthn_credential_id",
      });
    } catch {
      // index already exists
    }
  },

  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }

    try {
      await context.removeIndex(TABLE, "users_webauthn_credential_id");
    } catch {
      // index absent
    }

    for (const column of Object.keys(COLUMNS)) {
      if (desc[column]) {
        await context.removeColumn(TABLE, column);
      }
    }
  },
};
