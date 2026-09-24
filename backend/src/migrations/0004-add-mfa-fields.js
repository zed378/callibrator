"use strict";

const TABLE = "users";

module.exports = {
  up: async ({ context }) => {
    // D-14: no catch. db.sync() runs before migrations, so the table exists;
    // the only error a catch here could swallow is a real one.
    const desc = await context.describeTable(TABLE);
    const DataTypes = context.sequelize.Sequelize.DataTypes;
    
    if (!desc.mfa_enabled) {
      await context.addColumn(TABLE, "mfa_enabled", {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: true,
      });
    }
    
    if (!desc.mfa_secret) {
      await context.addColumn(TABLE, "mfa_secret", {
        type: DataTypes.STRING(255),
        allowNull: true,
      });
    }
  },

  down: async ({ context }) => {
    // D-14: no catch. db.sync() runs before migrations, so the table exists;
    // the only error a catch here could swallow is a real one.
    const desc = await context.describeTable(TABLE);
    
    if (desc.mfa_enabled) {
      await context.removeColumn(TABLE, "mfa_enabled");
    }
    
    if (desc.mfa_secret) {
      await context.removeColumn(TABLE, "mfa_secret");
    }
  },
};
