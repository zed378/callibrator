// D-17 — NO tenant column, so the global tenant hooks never scope this model: join row of a scoped KanbanCard. Every query names cardId.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Kanban Card Assignee (join)
 *
 * Assigns a card to a user. Assigning a user is the "tagging" event that
 * triggers a notification, and assignees are watchers for later updates.
 *
 * P9-10 batch 1 (ADR-087 Amendment 7): converted from
 * kanbanCardAssignee.model.js with no behaviour change (see kanbanLabel.model.ts).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { UserId } from "../types/ids";
import { initModel, type TypedModel } from "./initModel";

/** A KanbanCardAssignee row (attributes, included associations). Types only: emits nothing. */
interface KanbanCardAssignee extends Model<
  InferAttributes<KanbanCardAssignee>,
  InferCreationAttributes<KanbanCardAssignee>
> {
  id: CreationOptional<string>;
  cardId: string;
  userId: UserId;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

type DefineKanbanCardAssignee = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<KanbanCardAssignee>;

const defineModel: DefineKanbanCardAssignee = (db, DataTypes) => {
  const KanbanCardAssignee = initModel<KanbanCardAssignee>(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "kanban_card_assignees",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["card_id"] },
        { fields: ["user_id"] },
        { unique: true, fields: ["card_id", "user_id"] },
      ],
      modelName: "KanbanCardAssignee",
      sequelize: db,
    },
  );

  return KanbanCardAssignee;
};

export = defineModel;
