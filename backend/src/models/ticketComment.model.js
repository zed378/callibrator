/**
 * Ticket Comment
 *
 * One message in a ticket's conversation thread. `isInternal` marks an
 * agent-only note that the requester should not see.
 */
const defineModel = (db, DataTypes) => {
  const TicketComment = db.define(
    "TicketComment",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      ticketId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tickets", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Internal notes are visible to agents only, not the requester.
      isInternal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "ticket_comments",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["ticket_id"] }],
    },
  );

  TicketComment.associate = (models) => {
    TicketComment.belongsTo(models.Ticket, {
      foreignKey: "ticket_id",
      as: "ticket",
    });
    TicketComment.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "author",
    });
  };

  return TicketComment;
};

module.exports = defineModel;
