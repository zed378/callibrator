/**
 * SignatureRecord Model — an executed electronic signature (21 CFR Part 11)
 *
 * The tamper-evident record produced when a signer completes a workflow step:
 * a hash binding the document + signer + tenant, plus the authentication method,
 * IP/user-agent, and optional biometric/polygon capture. Distinct from
 * ESignatureRecord, which is the certificate module's polymorphic compliance log.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from signatureRecord.model.js with no behaviour
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
import {
  jsonShape,
  type SignatureBiometricData,
  type SignaturePolygon,
} from "../utils/jsonShape.util";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const SIGNATURE_RECORD_STATUSES = ["signed", "revoked"] as const;

/** A SignatureRecord row (attributes, included associations, instance methods). Types only: emits nothing. */
interface SignatureRecord extends Model<
  InferAttributes<SignatureRecord>,
  InferCreationAttributes<SignatureRecord>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  workflowId: string;
  workflowStepId: string;
  userId: UserId;
  signatureHash: string;
  /** NULL on records written before ADR-040 (unverifiable by design). */
  signatureValue: string | null;
  signingKeyId: string | null;
  signatureScheme: string | null;
  signatureReason: string | null;
  signatureAlgorithm: CreationOptional<string>;
  /** JSON, D-27 shape `SignatureRecord.polygon`. */
  polygon: SignaturePolygon | null;
  /** JSON, D-27 shape `SignatureRecord.biometricData`. */
  biometricData: SignatureBiometricData | null;
  authenticationMethod: CreationOptional<string>;
  signedAt: CreationOptional<Date>;
  ipAddress: string | null;
  userAgent: string | null;
  status: CreationOptional<(typeof SIGNATURE_RECORD_STATUSES)[number]>;
  revokedAt: Date | null;
  revokedBy: UserId | null;
  revocationReason: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  workflow?: NonAttribute<ModelInstance<"SignatureWorkflow">>;
  signer?: NonAttribute<ModelInstance<"User">>;
}

interface SignatureRecordStatics {
  associate: (models: Models) => void;
}

type DefineSignatureRecord = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<SignatureRecord, SignatureRecordStatics>;

/** Define the SignatureRecord model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineSignatureRecord = (db, DataTypes) => {
  const SignatureRecord = initModel<SignatureRecord, SignatureRecordStatics>(
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
      workflowId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "signature_workflows", key: "id" },
        onDelete: "RESTRICT",
      },
      workflowStepId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "signature_workflow_steps", key: "id" },
        // D-18 (migration 0066): the step a Part 11 signature executes. Was
        // CASCADE — a hard delete of the step erased its signatures.
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT", // the signer of a Part 11 record (ADR-051 Q-16)
      },
      signatureHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment:
          "SHA-256 of the canonical signed payload (the bytes signatureValue covers)",
      },
      signatureValue: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          "Base64 RSA-SHA256 signature over the canonical payload. NULL on " +
          "records written before ADR-040, which are unverifiable by design.",
      },
      signingKeyId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "TenantKey.keyId whose public half verifies signatureValue",
      },
      signatureScheme: {
        type: DataTypes.STRING(30),
        allowNull: true,
        comment:
          "Signing scheme ('esig-v2-rsa-sha256'); NULL marks a pre-ADR-040 record",
      },
      signatureReason: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment:
          "Meaning of the signature (21 CFR 11.50(a)(3)); bound into the payload",
      },
      signatureAlgorithm: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "RS256",
      },
      polygon: {
        type: DataTypes.JSON,
        validate: { shape: jsonShape("SignatureRecord.polygon") },
        allowNull: true,
        comment: "Captured hand-drawn signature polygon, if any",
      },
      biometricData: {
        type: DataTypes.JSON,
        validate: { shape: jsonShape("SignatureRecord.biometricData") },
        allowNull: true,
      },
      authenticationMethod: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "password",
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...SIGNATURE_RECORD_STATUSES),
        allowNull: false,
        defaultValue: "signed",
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revokedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        // A-149: who revoked a signature is a Part 11 attribution (11.50,
        // 11.70). It had no foreign key at all (migration 0017 made it a bare
        // UUID); RESTRICT refuses a hard delete of that user. Migration 0037.
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      revocationReason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: "signature_records",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["workflow_id"] },
        { fields: ["workflow_step_id"] },
        { fields: ["user_id"] },
        { fields: ["status"] },
      ],
      modelName: "SignatureRecord",
      sequelize: db,
    },
  );

  SignatureRecord.associate = (models: Models): void => {
    SignatureRecord.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    SignatureRecord.belongsTo(models.SignatureWorkflow, {
      foreignKey: "workflowId",
      as: "workflow",
      onDelete: "RESTRICT",
    });
    SignatureRecord.belongsTo(models.User, {
      foreignKey: "userId",
      as: "signer",
      onDelete: "RESTRICT",
    });
  };

  return SignatureRecord;
};

export = defineModel;
