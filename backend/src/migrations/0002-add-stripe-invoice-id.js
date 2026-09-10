// Adds invoices.stripe_invoice_id (nullable, unique) so Stripe webhook
// deliveries can be de-duplicated. Idempotent + reversible.

const TABLE = "invoices";
const COLUMN = "stripe_invoice_id";

module.exports = {
  up: async ({ context }) => {
    let desc;
    try {
      desc = await context.describeTable(TABLE);
    } catch {
      return; // table not present yet (fresh DB handled by db.sync)
    }
    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, {
        type: context.sequelize.Sequelize.DataTypes.STRING,
        allowNull: true,
        unique: true,
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
    if (desc[COLUMN]) {
      await context.removeColumn(TABLE, COLUMN);
    }
  },
};
