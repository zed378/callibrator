// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its KanbanProject (scoped). Every query names projectId.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Label ("tag")
 *
 * A per-project categorisation tag (e.g. "bug", "urgent") applied to cards
 * many-to-many via kanban_card_labels.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from kanbanLabel.model.js
 * with no behaviour change. The pattern (MEMORY/specs/P9-10-model-typing-pattern.md
 * as amended by ADR-087 Amendment 7): the row type is a module-level interface
 * and the statics another (types only), the factory is explicitly typed, and
 * `initModel` builds a fresh `class extends Model {}` exactly as `db.define`
 * did (definition equality, ADR-092 check (b); see initModel.ts).
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

/** A KanbanLabel row (attributes, included associations). Types only: emits nothing. */
interface KanbanLabel extends Model<
  InferAttributes<KanbanLabel>,
  InferCreationAttributes<KanbanLabel>
> {
  id: CreationOptional<string>;
  projectId: string;
  name: string;
  color: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  project?: NonAttribute<ModelInstance<"KanbanProject">>;
  cards?: NonAttribute<ModelInstance<"KanbanCard">[]>;
}

interface KanbanLabelStatics {
  associate: (models: Models) => void;
}

type DefineKanbanLabel = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanLabel, KanbanLabelStatics>;

const defineModel: DefineKanbanLabel = (db, DataTypes) => {
  const KanbanLabel = initModel<KanbanLabel, KanbanLabelStatics>(
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
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
    },
    {
      tableName: "kanban_labels",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["project_id"] }],
      modelName: "KanbanLabel",
      sequelize: db,
    },
  );

  KanbanLabel.associate = (models: Models): void => {
    KanbanLabel.belongsTo(models.KanbanProject, {
      foreignKey: "projectId",
      as: "project",
      onDelete: "CASCADE",
    });
    KanbanLabel.belongsToMany(models.KanbanCard, {
      through: models.KanbanCardLabel,
      foreignKey: "labelId",
      otherKey: "cardId",
      as: "cards",
    });
  };

  return KanbanLabel;
};

export = defineModel;
