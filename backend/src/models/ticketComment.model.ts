// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its Ticket (scoped, loaded by loadTicket). Every query names ticketId (one reviewed exception).
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Ticket Comment
 *
 * One message in a ticket's conversation thread. `isInternal` marks an
 * agent-only note that the requester should not see.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from ticketComment.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
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

/** A TicketComment row (attributes, included associations, instance methods). Types only: emits nothing. */
interface TicketComment extends Model<
  InferAttributes<TicketComment>,
  InferCreationAttributes<TicketComment>
> {
  id: CreationOptional<string>;
  ticketId: string;
  userId: UserId | null;
  body: string;
  /** Agent-only note, hidden from the requester. */
  isInternal: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  ticket?: NonAttribute<ModelInstance<"Ticket">>;
  author?: NonAttribute<ModelInstance<"User">>;
}

interface TicketCommentStatics {
  associate: (models: Models) => void;
}

type DefineTicketComment = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<TicketComment, TicketCommentStatics>;

/** Define the TicketComment model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTicketComment = (db, DataTypes) => {
  const TicketComment = initModel<TicketComment, TicketCommentStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      ticketId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tickets", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Internal notes are visible to agents only, not the requester.
      isInternal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "ticket_comments",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["ticket_id"] }],
      modelName: "TicketComment",
      sequelize: db,
    },
  );

  TicketComment.associate = (models: Models): void => {
    TicketComment.belongsTo(models.Ticket, {
      foreignKey: "ticketId",
      as: "ticket",
      onDelete: "CASCADE",
    });
    TicketComment.belongsTo(models.User, {
      foreignKey: "userId",
      as: "author",
      onDelete: "SET NULL",
    });
  };

  return TicketComment;
};

export = defineModel;
