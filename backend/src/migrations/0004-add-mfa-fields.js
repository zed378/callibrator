"use strict";

const TABLE = "users";

module.exports = {
  up: async ({ context }) => {
    let desc;
    try {
      desc = await context.describeTable(TABLE);
    } catch {
      return; // table not present yet
    }
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
    let desc;
    try {
      desc = await context.describeTable(TABLE);
    } catch {
      return;
    }
    
    if (desc.mfa_enabled) {
      await context.removeColumn(TABLE, "mfa_enabled");
    }
    
    if (desc.mfa_secret) {
      await context.removeColumn(TABLE, "mfa_secret");
    }
  },
};
