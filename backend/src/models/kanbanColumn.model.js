/**
 * Kanban Column (List)
 *
 * The dynamic per-tenant flow: every project starts with a seeded set
 * (To Do / In Progress / Done) that the owner can rename, reorder, add to or
 * remove. Columns are ordered by `position` (ascending).
 */
const defineModel = (db, DataTypes) => {
  const KanbanColumn = db.define(
    "KanbanColumn",
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
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Optional work-in-progress limit; null = no limit.
      wipLimit: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The terminal "Done" column: cannot be deleted and is always kept last.
      isDone: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "kanban_columns",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["project_id"] }],
    },
  );

  KanbanColumn.associate = (models) => {
    KanbanColumn.belongsTo(models.KanbanProject, {
      foreignKey: "project_id",
      as: "project",
    });
    KanbanColumn.hasMany(models.KanbanCard, {
      foreignKey: "column_id",
      as: "cards",
      onDelete: "CASCADE",
    });
  };

  return KanbanColumn;
};

module.exports = defineModel;
