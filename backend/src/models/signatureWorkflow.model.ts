/**
 * SignatureWorkflow Model — e-Signature routing envelope
 *
 * One signing request over a document, routed sequentially through its
 * SignatureWorkflowSteps. Tenant-scoped for isolation.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from signatureWorkflow.model.js with no behaviour
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
const SIGNATURE_WORKFLOW_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
] as const;

/** A SignatureWorkflow row (attributes, included associations, instance methods). Types only: emits nothing. */
interface SignatureWorkflow extends Model<
  InferAttributes<SignatureWorkflow>,
  InferCreationAttributes<SignatureWorkflow>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  documentId: string;
  subject: CreationOptional<string>;
  message: string | null;
  status: CreationOptional<(typeof SIGNATURE_WORKFLOW_STATUSES)[number]>;
  expiresAt: Date | null;
  signatureAlgorithm: CreationOptional<string>;
  requestedBy: UserId | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  steps?: NonAttribute<ModelInstance<"SignatureWorkflowStep">[]>;
  signatures?: NonAttribute<ModelInstance<"SignatureRecord">[]>;
  requester?: NonAttribute<ModelInstance<"User">>;
}

interface SignatureWorkflowStatics {
  associate: (models: Models) => void;
}

type DefineSignatureWorkflow = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<SignatureWorkflow, SignatureWorkflowStatics>;

/** Define the SignatureWorkflow model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineSignatureWorkflow = (db, DataTypes) => {
  const SignatureWorkflow = initModel<
    SignatureWorkflow,
    SignatureWorkflowStatics
  >(
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
      documentId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Identifier of the document being signed",
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "Please sign this document",
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...SIGNATURE_WORKFLOW_STATUSES),
        allowNull: false,
        defaultValue: "pending",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      signatureAlgorithm: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "RS256",
      },
      // A-170: the user who requested the signatures — set once, at creation,
      // from the authenticated actor (never the body). The completion email
      // goes to them. Nullable only for workflows created before migration
      // 0039; RESTRICT, like every other Part 11 attribution (A-149).
      requestedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
    },
    {
      tableName: "signature_workflows",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["document_id"] },
        { fields: ["status"] },
        // `signature_workflows_requested_by` is created by migration 0039,
        // not here: boot runs sync() BEFORE the migrations, and an index on a
        // column an existing database does not have yet fails the boot.
      ],
      modelName: "SignatureWorkflow",
      sequelize: db,
    },
  );

  SignatureWorkflow.associate = (models: Models): void => {
    SignatureWorkflow.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    SignatureWorkflow.hasMany(models.SignatureWorkflowStep, {
      foreignKey: "workflowId",
      as: "steps",
      onDelete: "RESTRICT",
    });
    SignatureWorkflow.hasMany(models.SignatureRecord, {
      foreignKey: "workflowId",
      as: "signatures",
      onDelete: "RESTRICT",
    });
    // A-170 — the requester. The attribute (not the column) names the key.
    SignatureWorkflow.belongsTo(models.User, {
      foreignKey: "requestedBy",
      as: "requester",
      onDelete: "RESTRICT",
    });
  };

  return SignatureWorkflow;
};

export = defineModel;
