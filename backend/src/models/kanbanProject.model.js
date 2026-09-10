/**
 * Kanban Project (Board)
 *
 * A project IS a single kanban board: it owns its own columns and cards, and a
 * membership list that controls who can see or edit it. Scoped to a tenant.
 */
const defineModel = (db, DataTypes) => {
  const KanbanProject = db.define(
    "KanbanProject",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Short identifier used as the card-key prefix, e.g. "MGT" -> MGT-1.
      code: {
        type: DataTypes.STRING(12),
        allowNull: true,
      },
      // Monotonic per-project counter driving card numbers; never decremented,
      // so deleting a card does not recycle its key.
      cardSeq: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Accent colour for the board card in the project list (hex).
      color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "kanban_projects",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }],
    },
  );

  KanbanProject.associate = (models) => {
    KanbanProject.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    KanbanProject.belongsTo(models.User, {
      foreignKey: "created_by",
      as: "creator",
    });
    KanbanProject.hasMany(models.KanbanProjectMember, {
      foreignKey: "project_id",
      as: "members",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanColumn, {
      foreignKey: "project_id",
      as: "columns",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanCard, {
      foreignKey: "project_id",
      as: "cards",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanLabel, {
      foreignKey: "project_id",
      as: "labels",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanSprint, {
      foreignKey: "project_id",
      as: "sprints",
      onDelete: "CASCADE",
    });
  };

  return KanbanProject;
};

module.exports = defineModel;
