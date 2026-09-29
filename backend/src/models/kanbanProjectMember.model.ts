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
 * accessLevel is a STRING column (the service holds the list), typed `string`.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from
 * kanbanProjectMember.model.js with no behaviour change (see kanbanLabel.model.ts).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A KanbanProjectMember row (attributes, included associations). Types only: emits nothing. */
interface KanbanProjectMember extends Model<
  InferAttributes<KanbanProjectMember>,
  InferCreationAttributes<KanbanProjectMember>
> {
  id: CreationOptional<string>;
  projectId: string;
  userId: UserId | null;
  roleId: string | null;
  accessLevel: CreationOptional<string>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  project?: NonAttribute<ModelInstance<"KanbanProject">>;
  user?: NonAttribute<ModelInstance<"User">>;
  role?: NonAttribute<ModelInstance<"Role">>;
}

interface KanbanProjectMemberStatics {
  associate: (models: Models) => void;
}

type DefineKanbanProjectMember = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanProjectMember, KanbanProjectMemberStatics>;

const defineModel: DefineKanbanProjectMember = (db, DataTypes) => {
  const KanbanProjectMember = initModel<
    KanbanProjectMember,
    KanbanProjectMemberStatics
  >(
    class extends Model {},
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
      modelName: "KanbanProjectMember",
      sequelize: db,
    },
  );

  KanbanProjectMember.associate = (models: Models): void => {
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

export = defineModel;
