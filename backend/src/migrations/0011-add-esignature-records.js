/**
 * e_signature_records — (re)created with the columns 0011 has always created.
 *
 * A-147. This migration used to open with
 *   dropTable('e_signature_records', { cascade: true }), with an empty catch handler
 * chained on, and the same on its two `DROP TYPE` queries. Two things were wrong:
 *
 *  1. The blanket catch. `dropTable` issues `DROP TABLE IF EXISTS`, so a
 *     missing table never throws: the only errors it could swallow were real
 *     ones (a lock timeout, a permission, a dependency). The `createTable`
 *     that follows is `CREATE TABLE IF NOT EXISTS`, so after a swallowed drop
 *     it silently did nothing and Umzug recorded 0011 as applied over a
 *     table it never built — the 0008/0013/0014 failure (CLAUDE.md: a
 *     migration with a blanket try/catch is recorded as applied while doing
 *     nothing).
 *  2. The unconditional drop. Boot runs `db.sync()` first, so the table
 *     always exists when 0011 runs. On a fresh database it is empty and the
 *     drop is harmless. On a database that reaches 0011 with rows in it — one
 *     that predates the migrator, or restored without its `schema_migrations`
 *     — it would have destroyed signature records (21 CFR Part 11).
 *
 * The fix, and why it is safe:
 *  - The name is frozen and 0011 has already run on every deployed database,
 *    so nothing here re-runs there: this edit changes nothing on them.
 *  - On a fresh database the effect is IDENTICAL to before (drop the empty
 *    table sync() built, recreate it as 0011 always has), so fresh and
 *    migrated databases keep converging on the same schema through 0030.
 *  - The catches are gone: any error now fails the migration, and it is not
 *    recorded as applied.
 *  - It REFUSES, instead of dropping, a table that holds rows. Nothing is
 *    deleted; an operator decides.
 */
module.exports = {
  up: async ({ context }) => {
    const queryInterface = context.queryInterface || context;
    const { DataTypes, Sequelize } = require("sequelize");

    const [[present]] = await queryInterface.sequelize.query(
      "SELECT to_regclass(current_schema() || '.e_signature_records') IS NOT NULL AS exists",
    );
    if (present.exists) {
      const [[{ n }]] = await queryInterface.sequelize.query(
        "SELECT count(*)::int AS n FROM e_signature_records",
      );
      if (n > 0) {
        throw new Error(
          `Migration 0011 refused: e_signature_records already holds ${n} row(s). This migration ` +
            "drops and recreates that table, which would destroy signature records (21 CFR " +
            "Part 11). Nothing was changed. A database with signature records should already " +
            "have 0011 recorded in schema_migrations — find out why it does not (a restore " +
            "without that table?) and record it deliberately instead of re-running it (A-147).",
        );
      }
    }

    await queryInterface.dropTable("e_signature_records", { cascade: true });
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_action";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";');
    await queryInterface.createTable("e_signature_records", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      entity_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      action: {
        type: DataTypes.ENUM("approve", "sign", "revoke"),
        allowNull: false,
      },
      meaning: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      auth_method: {
        type: DataTypes.ENUM("password", "mfa", "sso"),
        allowNull: false,
      },
      document_hash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("e_signature_records", ["tenant_id"]);
    await queryInterface.addIndex("e_signature_records", ["entity_type", "entity_id"]);
    await queryInterface.addIndex("e_signature_records", ["user_id"]);
  },

  down: async ({ context }) => {
    const queryInterface = context.queryInterface || context;
    await queryInterface.dropTable("e_signature_records");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_action";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";');
  },
};
