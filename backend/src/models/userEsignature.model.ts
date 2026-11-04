/**
 * UserEsignature Model — a user's personal e-signature (P21-15; ADR-140; spec
 * MEMORY/specs/P21-15-operator-esignature.md v2 § 2.1).
 *
 * A visual specimen (sanitised SVG, validated against the allow-list of
 * @callibrator/contracts/esignatures#specimenProblem) and an RSA-3072 key pair. The private half is
 * a KMS envelope (`privateKeyEnc`, the mechanism `tenant_keys` uses — signingKeyWrap.service); it is
 * never returned and never logged. ONE active row per user (migration 0149's partial UNIQUE); a
 * replacement is a new version and the old row becomes `superseded`; a revoked row means "do not use
 * from now on". Append-mostly for every role (0149's trigger): never deleted, and only the
 * lifecycle columns of an ACTIVE row ever change. The application role has SELECT, INSERT and UPDATE
 * of those four columns.
 *
 * TENANT-scoped (the hooks). NOT paranoid, NO defaultScope, no `updated_at`; no index declared (all
 * in 0149, ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { EsigStatus } from "@callibrator/contracts/esignatures";
import type { TenantId, UserEsignatureId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A UserEsignature row. Types only: emits nothing. */
interface UserEsignature extends Model<InferAttributes<UserEsignature>, InferCreationAttributes<UserEsignature>> {
  id: CreationOptional<UserEsignatureId>;
  tenantId: TenantId;
  userId: UserId;
  version: number;
  specimenSvg: string;
  publicKeyPem: string;
  /** The private key as a KMS envelope. Never returned by any contract, never logged. */
  privateKeyEnc: string;
  /** SHA-256 of the public key's SPKI DER, lower-case hex. */
  keyFingerprint: string;
  status: EsigStatus;
  createdAt: CreationOptional<Date>;
  supersededAt: CreationOptional<Date | null>;
  revokedAt: CreationOptional<Date | null>;
  revokedReason: CreationOptional<string | null>;
}

interface UserEsignatureStatics {
  associate: (models: Models) => void;
}

type DefineUserEsignature = (db: Sequelize, DataTypes: typeof DataTypesNamespace) => TypedModel<UserEsignature, UserEsignatureStatics>;

/** Define the UserEsignature model on `db`. */
const defineModel: DefineUserEsignature = (db, DataTypes) => {
  const UserEsignature = initModel<UserEsignature, UserEsignatureStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false, references: { model: "tenants", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      userId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      version: { type: DataTypes.INTEGER, allowNull: false },
      specimenSvg: { type: DataTypes.TEXT, allowNull: false },
      publicKeyPem: { type: DataTypes.TEXT, allowNull: false },
      privateKeyEnc: { type: DataTypes.TEXT, allowNull: false },
      keyFingerprint: { type: DataTypes.CHAR(64), allowNull: false },
      status: { type: DataTypes.STRING(12), allowNull: false },
      supersededAt: { type: DataTypes.DATE, allowNull: true },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      revokedReason: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: "user_esignatures",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "UserEsignature",
      sequelize: db,
    },
  );

  UserEsignature.associate = (models: Models): void => {
    UserEsignature.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    UserEsignature.belongsTo(models.User, { foreignKey: "userId", as: "owner", onDelete: "RESTRICT" });
  };

  return UserEsignature;
};

export = defineModel;
