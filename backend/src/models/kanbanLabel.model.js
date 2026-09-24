// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its KanbanProject (scoped). Every query names projectId.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Label ("tag")
 *
 * A per-project categorisation tag (e.g. "bug", "urgent") applied to cards
 * many-to-many via kanban_card_labels.
 */
const defineModel = (db, DataTypes) => {
  const KanbanLabel = db.define(
    "KanbanLabel",
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
      name: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
    },
    {
      tableName: "kanban_labels",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["project_id"] }],
    },
  );

  KanbanLabel.associate = (models) => {
    KanbanLabel.belongsTo(models.KanbanProject, {
      foreignKey: "projectId",
      as: "project",
      onDelete: "CASCADE",
    });
    KanbanLabel.belongsToMany(models.KanbanCard, {
      through: models.KanbanCardLabel,
      foreignKey: "labelId",
      otherKey: "cardId",
      as: "cards",
    });
  };

  return KanbanLabel;
};

module.exports = defineModel;
