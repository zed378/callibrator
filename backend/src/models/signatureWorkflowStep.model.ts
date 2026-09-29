/**
 * SignatureWorkflowStep Model — a single signer's slot in a workflow
 *
 * Steps are ordered by stepNumber; the first is `pending`, later ones `waiting`
 * until their turn. Carries tenantId so the signing path (which reads
 * step.tenantId) and the tenant-isolation hooks both stay correct.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from signatureWorkflowStep.model.js with no behaviour
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
const SIGNATURE_STEP_STATUSES = [
  "waiting",
  "pending",
  "signed",
  "declined",
] as const;

/** A SignatureWorkflowStep row (attributes, included associations, instance methods). Types only: emits nothing. */
interface SignatureWorkflowStep extends Model<
  InferAttributes<SignatureWorkflowStep>,
  InferCreationAttributes<SignatureWorkflowStep>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  workflowId: string;
  stepNumber: number;
  signerId: UserId | null;
  signerEmail: string;
  signerName: string | null;
  status: CreationOptional<(typeof SIGNATURE_STEP_STATUSES)[number]>;
  signedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  workflow?: NonAttribute<ModelInstance<"SignatureWorkflow">>;
}

interface SignatureWorkflowStepStatics {
  associate: (models: Models) => void;
}

type DefineSignatureWorkflowStep = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<SignatureWorkflowStep, SignatureWorkflowStepStatics>;

/** Define the SignatureWorkflowStep model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineSignatureWorkflowStep = (db, DataTypes) => {
  const SignatureWorkflowStep = initModel<
    SignatureWorkflowStep,
    SignatureWorkflowStepStatics
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
        onDelete: "RESTRICT", // ADR-051 Q-16; matches migration 0030
        onUpdate: "CASCADE", // as every association-built tenant FK
      },
      workflowId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "signature_workflows", key: "id" },
        onDelete: "RESTRICT",
      },
      stepNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      signerId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "User id of the signer, when they are an internal user",
        // A-149: the signer of a regulated record (Part 11). It had no foreign
        // key at all (migration 0017 made it a bare UUID); RESTRICT refuses a
        // hard delete of that user. Nullable: rows from before A-86 may name
        // an e-mail-only signer. Migration 0037.
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      signerEmail: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      signerName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...SIGNATURE_STEP_STATUSES),
        allowNull: false,
        defaultValue: "waiting",
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: "signature_workflow_steps",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["workflow_id"] },
        { fields: ["status"] },
      ],
      modelName: "SignatureWorkflowStep",
      sequelize: db,
    },
  );

  SignatureWorkflowStep.associate = (models: Models): void => {
    SignatureWorkflowStep.belongsTo(models.SignatureWorkflow, {
      foreignKey: "workflowId",
      as: "workflow",
      onDelete: "RESTRICT",
    });
  };

  return SignatureWorkflowStep;
};

export = defineModel;
