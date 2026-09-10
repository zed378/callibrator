// Adds Postgres full-text-search support: a generated `search_vector` tsvector
// column + GIN index on calibration_devices, stocks, and certificates.
// Generated STORED columns auto-maintain themselves on insert/update (no
// triggers) and require Postgres 12+. Idempotent + reversible.

const TABLES = {
  calibration_devices: ["name", "serial_number", "manufacturer", "model", "category"],
  stocks: ["item_name", "sku", "serial_number", "description"],
  certificates: ["certificate_number", "standard", "summary"],
};

module.exports = {
  up: async ({ context }) => {
    const sequelize = context.sequelize;
    for (const [table, cols] of Object.entries(TABLES)) {
      const expr = cols.map((c) => `coalesce("${c}", '')`).join(" || ' ' || ");
      await sequelize.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "search_vector" tsvector ` +
          `GENERATED ALWAYS AS (to_tsvector('english', ${expr})) STORED;`,
      );
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS "idx_${table}_search" ` +
          `ON "${table}" USING GIN ("search_vector");`,
      );
    }
  },
  down: async ({ context }) => {
    const sequelize = context.sequelize;
    for (const table of Object.keys(TABLES)) {
      await sequelize.query(`DROP INDEX IF EXISTS "idx_${table}_search";`);
      await sequelize.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "search_vector";`,
      );
    }
  },
};
