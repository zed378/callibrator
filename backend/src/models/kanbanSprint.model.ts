// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its KanbanProject (scoped). Every query names projectId.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Sprint
 *
 * A time-boxed iteration within a project. Cards belong to at most one sprint
 * (null = backlog). The board loads one sprint's cards at a time so a busy
 * project never fetches everything at once. status is a STRING column
 * (planned | active | completed, held by the service), typed `string`.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from kanbanSprint.model.js
 * with no behaviour change (see kanbanLabel.model.ts).
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
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A KanbanSprint row (attributes, included associations). Types only: emits nothing. */
interface KanbanSprint extends Model<
  InferAttributes<KanbanSprint>,
  InferCreationAttributes<KanbanSprint>
> {
  id: CreationOptional<string>;
  projectId: string;
  name: string;
  goal: string | null;
  status: CreationOptional<string>;
  startDate: Date | null;
  endDate: Date | null;
  position: CreationOptional<number>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  project?: NonAttribute<ModelInstance<"KanbanProject">>;
  cards?: NonAttribute<ModelInstance<"KanbanCard">[]>;
}

interface KanbanSprintStatics {
  associate: (models: Models) => void;
}

type DefineKanbanSprint = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanSprint, KanbanSprintStatics>;

const defineModel: DefineKanbanSprint = (db, DataTypes) => {
  const KanbanSprint = initModel<KanbanSprint, KanbanSprintStatics>(
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
      modelName: "KanbanSprint",
      sequelize: db,
    },
  );

  KanbanSprint.associate = (models: Models): void => {
    KanbanSprint.belongsTo(models.KanbanProject, {
      foreignKey: "projectId",
      as: "project",
      onDelete: "CASCADE",
    });
    KanbanSprint.hasMany(models.KanbanCard, {
      foreignKey: "sprintId",
      as: "cards",
      onDelete: "SET NULL",
    });
  };

  return KanbanSprint;
};

export = defineModel;
