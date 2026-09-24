// Adds invoices.stripe_invoice_id (nullable, unique) so Stripe webhook
// deliveries can be de-duplicated. Idempotent + reversible.

const TABLE = "invoices";
const COLUMN = "stripe_invoice_id";

module.exports = {
  up: async ({ context }) => {
    // D-14: no catch. db.sync() runs before migrations, so the table exists;
    // the only error a catch here could swallow is a real one.
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, {
        type: context.sequelize.Sequelize.DataTypes.STRING,
        allowNull: true,
        unique: true,
      });
    }
  },
  down: async ({ context }) => {
    // D-14: no catch. db.sync() runs before migrations, so the table exists;
    // the only error a catch here could swallow is a real one.
    const desc = await context.describeTable(TABLE);
    if (desc[COLUMN]) {
      await context.removeColumn(TABLE, COLUMN);
    }
  },
};
