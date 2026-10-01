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
import { DataTypes } from "sequelize";
import type { QueryInterface } from "sequelize";

/**
 * The QueryInterface Umzug passes. `context.queryInterface || context` below is
 * the reviewed fallback frozen by D-29 (ADR-083): a real QueryInterface has no
 * `.queryInterface`, so it always takes `context`. It is kept as written.
 */
type Context = QueryInterface & { queryInterface?: QueryInterface };

export = {
  async up({ context }: { context: Context }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;

    const table = await queryInterface.describeTable("attachments");
    if (!table["storage_key"]) {
      await queryInterface.addColumn("attachments", "storage_key", {
        type: DataTypes.STRING(1024),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down({ context }: { context: Context }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;
    const table = await queryInterface.describeTable("attachments");
    if (table["storage_key"]) {
      await queryInterface.removeColumn("attachments", "storage_key");
    }
  },
};
