// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its KanbanProject (scoped). Every query names projectId (one reviewed exception).
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Project Member
 *
 * Grants access to a project, either to an individual user OR to a whole role.
 * accessLevel is one of:
 *   - owner  : manages membership, columns and can delete the project
 *   - editor : create/move/edit/delete cards
 *   - viewer : read-only
 *
 * Exactly one of userId / roleId is set per row (enforced in the service).
 */
const defineModel = (db, DataTypes) => {
  const KanbanProjectMember = db.define(
    "KanbanProjectMember",
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
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "roles", key: "id" },
        onDelete: "SET NULL",
      },
      accessLevel: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "viewer", // owner | editor | viewer
      },
    },
    {
      tableName: "kanban_project_members",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["project_id"] },
        { fields: ["user_id"] },
        { fields: ["role_id"] },
      ],
    },
  );

  KanbanProjectMember.associate = (models) => {
    KanbanProjectMember.belongsTo(models.KanbanProject, {
      foreignKey: "projectId",
      as: "project",
      onDelete: "CASCADE",
    });
    KanbanProjectMember.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
      onDelete: "SET NULL",
    });
    KanbanProjectMember.belongsTo(models.Role, {
      foreignKey: "roleId",
      as: "role",
      onDelete: "SET NULL",
    });
  };

  return KanbanProjectMember;
};

module.exports = defineModel;
