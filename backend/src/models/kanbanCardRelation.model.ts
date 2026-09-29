// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its KanbanProject / cards (scoped). Every query names a card or project id.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Card Relation
 *
 * A directed link between two cards in the same project. Stored in BOTH
 * directions on create (e.g. A "blocks" B also writes B "blocked_by" A) so a
 * card sees all its relations without an OR query.
 *
 * type is one of: relates_to, blocks, blocked_by, parent_of, child_of,
 * duplicates. The column is a STRING (the service holds the list), so the
 * attribute is typed `string`, as the database stores it.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from
 * kanbanCardRelation.model.js with no behaviour change (see kanbanLabel.model.ts).
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

/** A KanbanCardRelation row (attributes, included associations). Types only: emits nothing. */
interface KanbanCardRelation extends Model<
  InferAttributes<KanbanCardRelation>,
  InferCreationAttributes<KanbanCardRelation>
> {
  id: CreationOptional<string>;
  projectId: string;
  sourceCardId: string;
  targetCardId: string;
  type: string;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  sourceCard?: NonAttribute<ModelInstance<"KanbanCard">>;
  targetCard?: NonAttribute<ModelInstance<"KanbanCard">>;
}

interface KanbanCardRelationStatics {
  associate: (models: Models) => void;
}

type DefineKanbanCardRelation = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanCardRelation, KanbanCardRelationStatics>;

const defineModel: DefineKanbanCardRelation = (db, DataTypes) => {
  const KanbanCardRelation = initModel<
    KanbanCardRelation,
    KanbanCardRelationStatics
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
      sourceCardId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_cards", key: "id" },
        onDelete: "CASCADE",
      },
      targetCardId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_cards", key: "id" },
        onDelete: "CASCADE",
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
    },
    {
      tableName: "kanban_card_relations",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["source_card_id"] },
        { fields: ["target_card_id"] },
        {
          unique: true,
          fields: ["source_card_id", "target_card_id", "type"],
        },
      ],
      modelName: "KanbanCardRelation",
      sequelize: db,
    },
  );

  KanbanCardRelation.associate = (models: Models): void => {
    KanbanCardRelation.belongsTo(models.KanbanCard, {
      foreignKey: "sourceCardId",
      as: "sourceCard",
      onDelete: "CASCADE",
    });
    KanbanCardRelation.belongsTo(models.KanbanCard, {
      foreignKey: "targetCardId",
      as: "targetCard",
      onDelete: "CASCADE",
    });
  };

  return KanbanCardRelation;
};

export = defineModel;
