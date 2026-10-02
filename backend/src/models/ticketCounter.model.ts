/**
 * Ticket Counter
 *
 * One row per tenant holding a monotonic counter that drives ticket keys
 * (TKT-1, TKT-2, ...). Kept in its own table (rather than on the tenant row) so
 * the number can be claimed with a single atomic upsert and never recycled.
 * See ticket.service.ts `nextTicketNumber`.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from ticketCounter.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { TenantId } from "../types/ids";
import { initModel, type TypedModel } from "./initModel";

/** A TicketCounter row (attributes, included associations, instance methods). Types only: emits nothing. */
interface TicketCounter extends Model<
  InferAttributes<TicketCounter>,
  InferCreationAttributes<TicketCounter>
> {
  id: CreationOptional<string>;
  /** One row per tenant (unique). */
  tenantId: TenantId;
  seq: CreationOptional<number>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

type DefineTicketCounter = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<TicketCounter>;

/** Define the TicketCounter model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTicketCounter = (db, DataTypes) => {
  const TicketCounter = initModel<TicketCounter>(
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
        unique: true,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE", // ADR-051 Q-16; matches migration 0030
        onUpdate: "CASCADE", // as every association-built tenant FK
      },
      seq: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "ticket_counters",
      timestamps: true,
      underscored: true,
      modelName: "TicketCounter",
      sequelize: db,
    },
  );

  return TicketCounter;
};

export = defineModel;
