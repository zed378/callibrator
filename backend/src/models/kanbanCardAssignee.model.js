/**
 * Kanban Card Assignee (join)
 *
 * Assigns a card to a user. Assigning a user is the "tagging" event that
 * triggers a notification, and assignees are watchers for later updates.
 */
const defineModel = (db, DataTypes) => {
  const KanbanCardAssignee = db.define(
    "KanbanCardAssignee",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      cardId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_cards", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "kanban_card_assignees",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["card_id"] },
        { fields: ["user_id"] },
        { unique: true, fields: ["card_id", "user_id"] },
      ],
    },
  );

  return KanbanCardAssignee;
};

module.exports = defineModel;
