/**
 * ConsentRecord Model (GDPR consent management)
 *
 * Immutable-ish record of a data subject's consent decisions per processing
 * purpose. A withdrawal is recorded by flipping status to "withdrawn" and
 * stamping withdrawnAt (the granting row is retained for the audit history).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from consentRecord.model.js with no behaviour
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

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const CONSENT_STATUSES = ["granted", "withdrawn"] as const;

/** A ConsentRecord row (attributes, included associations, instance methods). Types only: emits nothing. */
interface ConsentRecord extends Model<
  InferAttributes<ConsentRecord>,
  InferCreationAttributes<ConsentRecord>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  userId: UserId;
  purpose: string;
  version: CreationOptional<string>;
  ipAddress: string | null;
  status: CreationOptional<(typeof CONSENT_STATUSES)[number]>;
  consentedAt: CreationOptional<Date>;
  withdrawnAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface ConsentRecordStatics {
  associate: (models: Models) => void;
}

type DefineConsentRecord = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<ConsentRecord, ConsentRecordStatics>;

/** Define the ConsentRecord model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineConsentRecord = (db, DataTypes) => {
  const ConsentRecord = initModel<ConsentRecord, ConsentRecordStatics>(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      // Consent purpose/category, e.g. analytics|marketing|functional|necessary
      purpose: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      version: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "1.0",
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...CONSENT_STATUSES),
        allowNull: false,
        defaultValue: "granted",
      },
      consentedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      withdrawnAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "consent_records",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["user_id"] },
        { fields: ["purpose"] },
      ],
      modelName: "ConsentRecord",
      sequelize: db,
    },
  );

  ConsentRecord.associate = (models: Models): void => {
    ConsentRecord.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    ConsentRecord.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
      onDelete: "RESTRICT",
    });
  };

  return ConsentRecord;
};

export = defineModel;
