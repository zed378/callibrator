/**
 * ClientFacilityMove Model — the log of a device moved between two client facilities of one
 * tenant, and the key the database checks before letting the facility column change (P20-07;
 * ADR-124 Am. 2 § 2; spec MEMORY/specs/P19-04-client-facilities.md § 5.5, § 11).
 *
 * The move operation (P21-09) inserts an `in_progress` row, names it in the transaction-local
 * setting `callibrator.facility_move`, updates the device — the composite foreign keys cascade the
 * facility to every child — and marks the row `completed` before commit. Migration 0117's
 * triggers make the row append-only (only `in_progress → completed` with `completedAt` and
 * `counts`), refuse DELETE and TRUNCATE, and refuse a COMMIT that leaves a row `in_progress` — so
 * an `in_progress` row is visible only to the transaction that inserted it.
 *
 * PROVIDER-INTERNAL: tenant-scoped, no `clientFacilityId` (its `from` names another client) —
 * bound principals are denied it (P21-09). Not paranoid, no defaultScope, no index declared
 * (all in 0117 — ADR-100 Am. 3). Its keys to the facilities and the device are composite
 * `(tenant_id, …)` foreign keys built by the migration; the model declares no `references` for
 * them (Sequelize cannot express a composite key).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { CLIENT_FACILITY_MOVE_STATUSES, type ClientFacilityMoveStatus } from "@callibrator/contracts/states";
import { jsonShape } from "../utils/jsonShape.util";
import type { ClientFacilityId, ClientFacilityMoveId, TenantId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** Children moved per table, and attachments flagged for re-keying (spec § 5.5). */
type ClientFacilityMoveCounts = Record<string, number>;

/** A ClientFacilityMove row. Types only: emits nothing. */
interface ClientFacilityMove extends Model<InferAttributes<ClientFacilityMove>, InferCreationAttributes<ClientFacilityMove>> {
  id: CreationOptional<ClientFacilityMoveId>;
  tenantId: TenantId;
  deviceId: string;
  fromClientFacilityId: ClientFacilityId;
  toClientFacilityId: ClientFacilityId;
  reason: string;
  status: CreationOptional<ClientFacilityMoveStatus>;
  /** JSONB, D-27 shape `ClientFacilityMove.counts`. */
  counts: CreationOptional<ClientFacilityMoveCounts | null>;
  movedBy: UserId;
  createdAt: CreationOptional<Date>;
  completedAt: CreationOptional<Date | null>;
}

interface ClientFacilityMoveStatics {
  associate: (models: Models) => void;
}

type DefineClientFacilityMove = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<ClientFacilityMove, ClientFacilityMoveStatics>;

/** Define the ClientFacilityMove model on `db`. */
const defineModel: DefineClientFacilityMove = (db, DataTypes) => {
  const ClientFacilityMove = initModel<ClientFacilityMove, ClientFacilityMoveStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
      },
      deviceId: { type: DataTypes.UUID, allowNull: false },
      fromClientFacilityId: { type: DataTypes.UUID, allowNull: false },
      toClientFacilityId: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: false },
      status: {
        type: DataTypes.ENUM(...CLIENT_FACILITY_MOVE_STATUSES),
        allowNull: false,
        defaultValue: "in_progress",
      },
      counts: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("ClientFacilityMove.counts") },
      },
      movedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      completedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "client_facility_moves",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "ClientFacilityMove",
      sequelize: db,
    },
  );

  ClientFacilityMove.associate = (models: Models): void => {
    // The tenant only: the keys to the facilities and the device are composite (migration 0117).
    ClientFacilityMove.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
  };

  return ClientFacilityMove;
};

export = defineModel;
