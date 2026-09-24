"use strict";

/**
 * Adds the tenant-lifecycle columns to `tenants` (W-01).
 *
 * services/tenantLifecycle.service.js has always written six properties that
 * were attributes of no model and columns of no table. Sequelize drops an
 * unknown property on save() without a word, so every suspension reason,
 * grace period and offboarding retention deadline was assigned to an object
 * and never stored — and the scheduled grace-period query filtered on
 * `"gracePeriodExpiresAt"`, a column that did not exist, and threw nightly.
 *
 * The Tenant model uses `underscored: true`, so each camelCase attribute maps
 * to the snake_case column named here. tests/migrations/0023-*.test.js asserts
 * these names equal the model's own `field` for each attribute.
 *
 * `tenants` pre-dates the model-driven db.sync() for these columns (sync never
 * alters an existing table), so the additions are made here. On a FRESH
 * database sync() has already created them from the model, and every step
 * below is a no-op. The (status, grace_period_expires_at) index lives only
 * here: declared on the model, sync() would try to create it on an upgraded
 * database BEFORE this migration adds the column, and refuse the boot.
 *
 * Idempotent + reversible.
 */
const TABLE = "tenants";
const INDEX = "tenants_status_grace_period_expires_at";

// Model attribute -> underscored column.
const COLUMNS = {
  suspension_reason: (DataTypes) => ({ type: DataTypes.TEXT, allowNull: true }),
  suspended_at: (DataTypes) => ({ type: DataTypes.DATE, allowNull: true }),
  suspended_by: (DataTypes) => ({ type: DataTypes.UUID, allowNull: true }),
  grace_period_expires_at: (DataTypes) => ({ type: DataTypes.DATE, allowNull: true }),
  offboarded_at: (DataTypes) => ({ type: DataTypes.DATE, allowNull: true }),
  offboard_retention_expires_at: (DataTypes) => ({ type: DataTypes.DATE, allowNull: true }),
};

/**
 * Only "this table doesn't exist yet" is a reason to skip. Anything else is a
 * real failure and must surface: a blanket `catch { return }` here would let
 * Umzug record this migration as applied while it had done nothing — which is
 * exactly how 0008/0013/0014 came to be marked done with their columns absent.
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

/** The index names on `tenants`, so the index step is idempotent without a catch. */
const indexNames = async (queryInterface) =>
  (await queryInterface.showIndex(TABLE)).map((index) => index.name);

module.exports = {
  TABLE,
  INDEX,
  COLUMNS,

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

    if (!(await indexNames(context)).includes(INDEX)) {
      await context.addIndex(TABLE, ["status", "grace_period_expires_at"], { name: INDEX });
    }
  },

  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }

    if ((await indexNames(context)).includes(INDEX)) {
      await context.removeIndex(TABLE, INDEX);
    }

    for (const column of Object.keys(COLUMNS)) {
      if (desc[column]) {
        await context.removeColumn(TABLE, column);
      }
    }
  },
};
