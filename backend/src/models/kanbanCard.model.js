/**
 * Kanban Card
 *
 * A unit of work on the board. Lives in exactly one column, ordered within it
 * by `position`. Images attach via the shared attachment service
 * (resourceType "KanbanCard", resourceId = card id) rather than a column here.
 */
const defineModel = (db, DataTypes) => {
  const KanbanCard = db.define(
    "KanbanCard",
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
      projectId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_projects", key: "id" },
        onDelete: "CASCADE",
      },
      columnId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_columns", key: "id" },
        onDelete: "CASCADE",
      },
      // Sprint the card belongs to; null = backlog.
      sprintId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "kanban_sprints", key: "id" },
        onDelete: "SET NULL",
      },
      // Per-project sequence number and its rendered key (e.g. 1 / "MGT-1").
      number: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      cardKey: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      title: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      priority: {
        type: DataTypes.STRING(20),
        allowNull: true, // low | medium | high | urgent
      },
      dueDate: {
        type: DataTypes.DATE,
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
      tableName: "kanban_cards",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["project_id"] },
        { fields: ["column_id"] },
        { fields: ["tenant_id"] },
      ],
    },
  );

  KanbanCard.associate = (models) => {
    KanbanCard.belongsTo(models.KanbanProject, {
      foreignKey: "project_id",
      as: "project",
    });
    KanbanCard.belongsTo(models.KanbanColumn, {
      foreignKey: "column_id",
      as: "column",
    });
    KanbanCard.belongsTo(models.KanbanSprint, {
      foreignKey: "sprint_id",
      as: "sprint",
    });
    KanbanCard.belongsTo(models.User, {
      foreignKey: "created_by",
      as: "creator",
    });
    // Assignees (users this card is assigned/tagged to)
    KanbanCard.belongsToMany(models.User, {
      through: models.KanbanCardAssignee,
      foreignKey: "card_id",
      otherKey: "user_id",
      as: "assignees",
    });
    // Labels ("tags" categorising the card)
    KanbanCard.belongsToMany(models.KanbanLabel, {
      through: models.KanbanCardLabel,
      foreignKey: "card_id",
      otherKey: "label_id",
      as: "labels",
    });
  };

  return KanbanCard;
};

module.exports = defineModel;
