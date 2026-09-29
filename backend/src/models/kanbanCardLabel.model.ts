// D-17 — NO tenant column, so the global tenant hooks never scope this model: join row of a scoped KanbanCard. Every query names cardId.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Card Label (join) — links a card to a label many-to-many.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from
 * kanbanCardLabel.model.js with no behaviour change (see kanbanLabel.model.ts).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { initModel, type TypedModel } from "./initModel";

/** A KanbanCardLabel row (attributes, included associations). Types only: emits nothing. */
interface KanbanCardLabel extends Model<
  InferAttributes<KanbanCardLabel>,
  InferCreationAttributes<KanbanCardLabel>
> {
  id: CreationOptional<string>;
  cardId: string;
  labelId: string;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

type DefineKanbanCardLabel = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanCardLabel>;

const defineModel: DefineKanbanCardLabel = (db, DataTypes) => {
  const KanbanCardLabel = initModel<KanbanCardLabel>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      cardId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_cards", key: "id" },
        onDelete: "CASCADE",
      },
      labelId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "kanban_labels", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "kanban_card_labels",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["card_id"] },
        { fields: ["label_id"] },
        { unique: true, fields: ["card_id", "label_id"] },
      ],
      modelName: "KanbanCardLabel",
      sequelize: db,
    },
  );

  return KanbanCardLabel;
};

export = defineModel;
