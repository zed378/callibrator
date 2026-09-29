// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its KanbanProject (scoped). Every query names projectId after assertAccess loaded the project.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Column (List)
 *
 * The dynamic per-tenant flow: every project starts with a seeded set
 * (To Do / In Progress / Done) that the owner can rename, reorder, add to or
 * remove. Columns are ordered by `position` (ascending).
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from kanbanColumn.model.js
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

/** A KanbanColumn row (attributes, included associations). Types only: emits nothing. */
interface KanbanColumn extends Model<
  InferAttributes<KanbanColumn>,
  InferCreationAttributes<KanbanColumn>
> {
  id: CreationOptional<string>;
  projectId: string;
  name: string;
  position: CreationOptional<number>;
  wipLimit: number | null;
  isDone: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  project?: NonAttribute<ModelInstance<"KanbanProject">>;
  cards?: NonAttribute<ModelInstance<"KanbanCard">[]>;
}

interface KanbanColumnStatics {
  associate: (models: Models) => void;
}

type DefineKanbanColumn = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanColumn, KanbanColumnStatics>;

const defineModel: DefineKanbanColumn = (db, DataTypes) => {
  const KanbanColumn = initModel<KanbanColumn, KanbanColumnStatics>(
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
      modelName: "KanbanColumn",
      sequelize: db,
    },
  );

  KanbanColumn.associate = (models: Models): void => {
    KanbanColumn.belongsTo(models.KanbanProject, {
      foreignKey: "projectId",
      as: "project",
      onDelete: "CASCADE",
    });
    KanbanColumn.hasMany(models.KanbanCard, {
      foreignKey: "columnId",
      as: "cards",
      onDelete: "CASCADE",
    });
  };

  return KanbanColumn;
};

export = defineModel;
