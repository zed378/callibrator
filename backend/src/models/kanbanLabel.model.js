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
      foreignKey: "project_id",
      as: "project",
    });
    KanbanLabel.belongsToMany(models.KanbanCard, {
      through: models.KanbanCardLabel,
      foreignKey: "label_id",
      otherKey: "card_id",
      as: "cards",
    });
  };

  return KanbanLabel;
};

module.exports = defineModel;
