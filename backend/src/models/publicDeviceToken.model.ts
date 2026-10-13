/**
 * PublicDeviceToken Model — a device's public link (P21-08; ADR-138 § 1 and Am. 1; spec
 * MEMORY/specs/P19-07-public-device-page.md § 5).
 *
 * Only the SHA-256 of the 22-character token is stored (`tokenHash`, 64 hex): a database dump hands
 * out no working sticker URL. A device has at most one active row (`revokedAt` NULL — the partial
 * UNIQUE index of migration 0137). Append-mostly, for every role (0137's trigger): a row is
 * inserted, and later its three revoke columns are set once, together; nothing else is ever
 * updated, and nothing is deleted. The application role has SELECT, INSERT and UPDATE of the
 * revoke columns only.
 *
 * TENANT-scoped (the hooks). NOT facility-scoped: no bound principal reaches a route that reads it
 * (the staff routes are not facility-accessible), and the public read resolves the hash with a
 * reviewed skip of both dimensions (FACILITY_SCOPE_SKIPS). The `tokenHash` UNIQUE index is global —
 * ADR-138 § 2's reviewed exception (a hash of a 128-bit random value is no existence oracle).
 *
 * NOT paranoid, NO defaultScope, no `updated_at`; no index declared (all in 0137, ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { PublicDeviceTokenRevokedReason } from "@callibrator/contracts/publicDevices";
import type { PublicDeviceTokenId, TenantId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A PublicDeviceToken row. Types only: emits nothing. */
interface PublicDeviceToken extends Model<InferAttributes<PublicDeviceToken>, InferCreationAttributes<PublicDeviceToken>> {
  id: CreationOptional<PublicDeviceTokenId>;
  tenantId: TenantId;
  deviceId: string;
  /** SHA-256 of the token, lower-case hex. Never returned by any contract. */
  tokenHash: string;
  createdBy: UserId;
  createdAt: CreationOptional<Date>;
  revokedAt: CreationOptional<Date | null>;
  revokedBy: CreationOptional<UserId | null>;
  revokedReason: CreationOptional<PublicDeviceTokenRevokedReason | null>;
}

interface PublicDeviceTokenStatics {
  associate: (models: Models) => void;
}

type DefinePublicDeviceToken = (db: Sequelize, DataTypes: typeof DataTypesNamespace) => TypedModel<PublicDeviceToken, PublicDeviceTokenStatics>;

/** Define the PublicDeviceToken model on `db`. */
const defineModel: DefinePublicDeviceToken = (db, DataTypes) => {
  const PublicDeviceToken = initModel<PublicDeviceToken, PublicDeviceTokenStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "calibration_devices", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      revokedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      revokedReason: { type: DataTypes.STRING(16), allowNull: true },
    },
    {
      tableName: "public_device_tokens",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "PublicDeviceToken",
      sequelize: db,
    },
  );

  PublicDeviceToken.associate = (models: Models): void => {
    PublicDeviceToken.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    PublicDeviceToken.belongsTo(models.CalibrationDevice, { foreignKey: "deviceId", as: "device", onDelete: "RESTRICT" });
  };

  return PublicDeviceToken;
};

export = defineModel;
