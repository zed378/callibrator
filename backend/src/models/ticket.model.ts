/**
 * Support Ticket
 *
 * A request raised by a user (the requester) and worked by an agent (the
 * assignee). Tenant-scoped, with a human-friendly incremental key (TKT-1) and a
 * lifecycle: open -> in_progress -> resolved -> closed (reopenable).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from ticket.model.js with no behaviour
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
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Ticket row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Ticket extends Model<
  InferAttributes<Ticket>,
  InferCreationAttributes<Ticket>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  number: number | null;
  ticketKey: string | null;
  subject: string;
  description: string | null;
  /** STRING column (open | in_progress | resolved | closed, held by the service). */
  status: CreationOptional<string>;
  /** STRING column (low | medium | high | urgent). */
  priority: CreationOptional<string>;
  /** STRING column (support | bug | feature | incident | question). */
  category: CreationOptional<string>;
  createdBy: UserId | null;
  assignedTo: UserId | null;
  dueDate: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  requester?: NonAttribute<ModelInstance<"User">>;
  assignee?: NonAttribute<ModelInstance<"User">>;
  comments?: NonAttribute<ModelInstance<"TicketComment">[]>;
}

interface TicketStatics {
  associate: (models: Models) => void;
}

type DefineTicket = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Ticket, TicketStatics>;

/** Define the Ticket model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTicket = (db, DataTypes) => {
  const Ticket = initModel<Ticket, TicketStatics>(
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
        onDelete: "RESTRICT",
      },
      // Per-tenant sequence number and its rendered key (e.g. 1 / "TKT-1").
      number: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      ticketKey: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "open", // open | in_progress | resolved | closed
      },
      priority: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "medium", // low | medium | high | urgent
      },
      category: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "support", // support | bug | feature | incident | question
      },
      // Requester (who raised it) and agent (who owns it; null = unassigned).
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "tickets",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["status"] },
        { fields: ["assigned_to"] },
        { fields: ["created_by"] },
      ],
      modelName: "Ticket",
      sequelize: db,
    },
  );

  Ticket.associate = (models: Models): void => {
    Ticket.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    Ticket.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "requester",
      onDelete: "SET NULL",
    });
    Ticket.belongsTo(models.User, {
      foreignKey: "assignedTo",
      as: "assignee",
      onDelete: "SET NULL",
    });
    Ticket.hasMany(models.TicketComment, {
      foreignKey: "ticketId",
      as: "comments",
      onDelete: "CASCADE",
    });
  };

  return Ticket;
};

export = defineModel;
