/**
 * Add `storage_key` to attachments.
 *
 * The pluggable storage layer (services/storage) addresses every object by a
 * tenant-scoped key (`t/<tenantId>/<domain>/<name>`) instead of a filesystem
 * `folder` + `fileName`. This column records that key.
 *
 * Nullable and defaulted to NULL so this migration is non-breaking: existing
 * rows keep working through the legacy folder/fileName path until the storage
 * migration tool (services/storageMigration) copies each file into the
 * configured backend and backfills its key.
 */
module.exports = {
  async up({ context }) {
    const queryInterface = context.queryInterface || context;
    const { DataTypes } = require("sequelize");

    const table = await queryInterface.describeTable("attachments");
    if (!table.storage_key) {
      await queryInterface.addColumn("attachments", "storage_key", {
        type: DataTypes.STRING(1024),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;
    const table = await queryInterface.describeTable("attachments");
    if (table.storage_key) {
      await queryInterface.removeColumn("attachments", "storage_key");
    }
  },
};
