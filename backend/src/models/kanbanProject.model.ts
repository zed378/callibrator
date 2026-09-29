/**
 * Kanban Project (Board)
 *
 * A project IS a single kanban board: it owns its own columns and cards, and a
 * membership list that controls who can see or edit it. Scoped to a tenant.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from kanbanProject.model.js
 * with no behaviour change (see kanbanLabel.model.ts). `paranoid`: Sequelize
 * adds `deletedAt` itself, so it is declared here and not passed to `init`.
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
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A KanbanProject row (attributes, included associations). Types only: emits nothing. */
interface KanbanProject extends Model<
  InferAttributes<KanbanProject>,
  InferCreationAttributes<KanbanProject>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  name: string;
  code: string | null;
  cardSeq: CreationOptional<number>;
  description: string | null;
  color: string | null;
  createdBy: UserId | null;
  archivedAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  creator?: NonAttribute<ModelInstance<"User">>;
  members?: NonAttribute<ModelInstance<"KanbanProjectMember">[]>;
  columns?: NonAttribute<ModelInstance<"KanbanColumn">[]>;
  cards?: NonAttribute<ModelInstance<"KanbanCard">[]>;
  labels?: NonAttribute<ModelInstance<"KanbanLabel">[]>;
  sprints?: NonAttribute<ModelInstance<"KanbanSprint">[]>;
}

interface KanbanProjectStatics {
  associate: (models: Models) => void;
}

type DefineKanbanProject = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanProject, KanbanProjectStatics>;

const defineModel: DefineKanbanProject = (db, DataTypes) => {
  const KanbanProject = initModel<KanbanProject, KanbanProjectStatics>(
    class extends Model {},
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
      modelName: "KanbanProject",
      sequelize: db,
    },
  );

  KanbanProject.associate = (models: Models): void => {
    KanbanProject.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
    KanbanProject.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "creator",
      onDelete: "SET NULL",
    });
    KanbanProject.hasMany(models.KanbanProjectMember, {
      foreignKey: "projectId",
      as: "members",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanColumn, {
      foreignKey: "projectId",
      as: "columns",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanCard, {
      foreignKey: "projectId",
      as: "cards",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanLabel, {
      foreignKey: "projectId",
      as: "labels",
      onDelete: "CASCADE",
    });
    KanbanProject.hasMany(models.KanbanSprint, {
      foreignKey: "projectId",
      as: "sprints",
      onDelete: "CASCADE",
    });
  };

  return KanbanProject;
};

export = defineModel;
