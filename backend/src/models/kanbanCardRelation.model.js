/**
 * Kanban Card Relation
 *
 * A directed link between two cards in the same project. Stored in BOTH
 * directions on create (e.g. A "blocks" B also writes B "blocked_by" A) so a
 * card sees all its relations without an OR query.
 *
 * type is one of: relates_to, blocks, blocked_by, parent_of, child_of,
 * duplicates.
 */
const defineModel = (db, DataTypes) => {
  const KanbanCardRelation = db.define(
    "KanbanCardRelation",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      projectId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_projects", key: "id" },
        onDelete: "CASCADE",
      },
      sourceCardId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_cards", key: "id" },
        onDelete: "CASCADE",
      },
      targetCardId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_cards", key: "id" },
        onDelete: "CASCADE",
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
    },
    {
      tableName: "kanban_card_relations",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["source_card_id"] },
        { fields: ["target_card_id"] },
        {
          unique: true,
          fields: ["source_card_id", "target_card_id", "type"],
        },
      ],
    },
  );

  KanbanCardRelation.associate = (models) => {
    KanbanCardRelation.belongsTo(models.KanbanCard, {
      foreignKey: "source_card_id",
      as: "sourceCard",
    });
    KanbanCardRelation.belongsTo(models.KanbanCard, {
      foreignKey: "target_card_id",
      as: "targetCard",
    });
  };

  return KanbanCardRelation;
};

module.exports = defineModel;
