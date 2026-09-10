/**
 * Kanban Sprint
 *
 * A time-boxed iteration within a project. Cards belong to at most one sprint
 * (null = backlog). The board loads one sprint's cards at a time so a busy
 * project never fetches everything at once.
 */
const defineModel = (db, DataTypes) => {
  const KanbanSprint = db.define(
    "KanbanSprint",
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
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      goal: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "planned", // planned | active | completed
      },
      startDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "kanban_sprints",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["project_id"] }],
    },
  );

  KanbanSprint.associate = (models) => {
    KanbanSprint.belongsTo(models.KanbanProject, {
      foreignKey: "project_id",
      as: "project",
    });
    KanbanSprint.hasMany(models.KanbanCard, {
      foreignKey: "sprint_id",
      as: "cards",
    });
  };

  return KanbanSprint;
};

module.exports = defineModel;
