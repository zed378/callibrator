// D-17 — NO tenant column, so the global tenant hooks never scope this model: join row of a scoped KanbanCard. Every query names cardId.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Card Label (join) — links a card to a label many-to-many.
 */
const defineModel = (db, DataTypes) => {
  const KanbanCardLabel = db.define(
    "KanbanCardLabel",
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
      labelId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_labels", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "kanban_card_labels",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["card_id"] },
        { fields: ["label_id"] },
        { unique: true, fields: ["card_id", "label_id"] },
      ],
    },
  );

  return KanbanCardLabel;
};

module.exports = defineModel;
