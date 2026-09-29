/**
 * Kanban Card
 *
 * A unit of work on the board. Lives in exactly one column, ordered within it
 * by `position`. Images attach via the shared attachment service
 * (resourceType "KanbanCard", resourceId = card id) rather than a column here.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from kanbanCard.model.js
 * with no behaviour change (see kanbanLabel.model.ts). `paranoid`: Sequelize
 * adds `deletedAt` itself, so it is declared here and not passed to `init`.
 * priority is a STRING column (low | medium | high | urgent, not enforced by
 * the database), typed `string`.
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

/** A KanbanCard row (attributes, included associations). Types only: emits nothing. */
interface KanbanCard extends Model<
  InferAttributes<KanbanCard>,
  InferCreationAttributes<KanbanCard>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  projectId: string;
  columnId: string;
  sprintId: string | null;
  number: number | null;
  cardKey: string | null;
  title: string;
  description: string | null;
  position: CreationOptional<number>;
  priority: string | null;
  dueDate: Date | null;
  createdBy: UserId | null;
  archivedAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  project?: NonAttribute<ModelInstance<"KanbanProject">>;
  column?: NonAttribute<ModelInstance<"KanbanColumn">>;
  sprint?: NonAttribute<ModelInstance<"KanbanSprint">>;
  creator?: NonAttribute<ModelInstance<"User">>;
  assignees?: NonAttribute<ModelInstance<"User">[]>;
  labels?: NonAttribute<ModelInstance<"KanbanLabel">[]>;
}

interface KanbanCardStatics {
  associate: (models: Models) => void;
}

type DefineKanbanCard = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanCard, KanbanCardStatics>;

const defineModel: DefineKanbanCard = (db, DataTypes) => {
  const KanbanCard = initModel<KanbanCard, KanbanCardStatics>(
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
        onDelete: "CASCADE", // ADR-051 Q-16; matches migration 0030
        onUpdate: "CASCADE", // as every association-built tenant FK
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
      modelName: "KanbanCard",
      sequelize: db,
    },
  );

  KanbanCard.associate = (models: Models): void => {
    KanbanCard.belongsTo(models.KanbanProject, {
      foreignKey: "projectId",
      as: "project",
      onDelete: "CASCADE",
    });
    KanbanCard.belongsTo(models.KanbanColumn, {
      foreignKey: "columnId",
      as: "column",
      onDelete: "CASCADE",
    });
    KanbanCard.belongsTo(models.KanbanSprint, {
      foreignKey: "sprintId",
      as: "sprint",
      onDelete: "SET NULL",
    });
    KanbanCard.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "creator",
      onDelete: "SET NULL",
    });
    // Assignees (users this card is assigned/tagged to)
    KanbanCard.belongsToMany(models.User, {
      through: models.KanbanCardAssignee,
      foreignKey: "cardId",
      otherKey: "userId",
      as: "assignees",
    });
    // Labels ("tags" categorising the card)
    KanbanCard.belongsToMany(models.KanbanLabel, {
      through: models.KanbanCardLabel,
      foreignKey: "cardId",
      otherKey: "labelId",
      as: "labels",
    });
  };

  return KanbanCard;
};

export = defineModel;
