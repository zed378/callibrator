/**
 * ESignatureRecord Model — Compliance logging
 *
 * Immutable audit trail of all electronic signatures to comply with 21 CFR Part 11.
 * Captures user intent, authentication method, document hash, IP address, and timestamp.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from eSignatureRecord.model.js with no behaviour
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

/** The `action` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const ESIGNATURE_ACTIONS = ["approve", "sign", "revoke"] as const;

/** The `authMethod` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const ESIGNATURE_AUTH_METHODS = ["password", "mfa", "sso"] as const;

/** A ESignatureRecord row (attributes, included associations, instance methods). Types only: emits nothing. */
interface ESignatureRecord extends Model<
  InferAttributes<ESignatureRecord>,
  InferCreationAttributes<ESignatureRecord>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  userId: UserId;
  action: (typeof ESIGNATURE_ACTIONS)[number];
  meaning: string;
  authMethod: (typeof ESIGNATURE_AUTH_METHODS)[number];
  documentHash: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** Immutable log: `timestamps: false` — this column is the only time. */
  timestamp: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface ESignatureRecordStatics {
  associate: (models: Models) => void;
}

type DefineESignatureRecord = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<ESignatureRecord, ESignatureRecordStatics>;

/** Define the ESignatureRecord model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineESignatureRecord = (db, DataTypes) => {
  const ESignatureRecord = initModel<ESignatureRecord, ESignatureRecordStatics>(
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
      entityType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment:
          "The type of entity being signed (e.g., Certificate, SOPDocument)",
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "The UUID of the entity being signed",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT", // the signer of a Part 11 record (ADR-051 Q-16)
      },
      action: {
        type: DataTypes.ENUM(...ESIGNATURE_ACTIONS),
        allowNull: false,
      },
      meaning: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "User's intent or meaning for the signature",
      },
      authMethod: {
        type: DataTypes.ENUM(...ESIGNATURE_AUTH_METHODS),
        allowNull: false,
      },
      documentHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment:
          "Cryptographic hash (e.g. SHA-256) of the document at time of signature",
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "e_signature_records",
      timestamps: false, // Immutable, no updatedAt or paranoid
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["entity_type", "entity_id"] },
        { fields: ["user_id"] },
      ],
      modelName: "ESignatureRecord",
      sequelize: db,
    },
  );

  ESignatureRecord.associate = (models: Models): void => {
    ESignatureRecord.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // Removed Certificate association since it's now polymorphic
    ESignatureRecord.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
      onDelete: "RESTRICT",
    });
  };

  return ESignatureRecord;
};

export = defineModel;
