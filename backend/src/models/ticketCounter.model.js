/**
 * Ticket Counter
 *
 * One row per tenant holding a monotonic counter that drives ticket keys
 * (TKT-1, TKT-2, ...). Kept in its own table (rather than on the tenant row) so
 * the number can be claimed with a single atomic upsert and never recycled.
 * See ticket.service.js `nextTicketNumber`.
 */
const defineModel = (db, DataTypes) => {
  const TicketCounter = db.define(
    "TicketCounter",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      seq: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "ticket_counters",
      timestamps: true,
      underscored: true,
    },
  );

  return TicketCounter;
};

module.exports = defineModel;
