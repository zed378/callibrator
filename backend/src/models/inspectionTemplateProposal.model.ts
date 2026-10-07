/**
 * InspectionTemplateProposal Model — a tenant's request to the platform
 * operator to change the global catalogue: a new device type, items to add,
 * change or retire (P20-03; ADR-125 § 5 and its Amendment 1; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.6, § 7.4).
 *
 * TENANT-SCOPED, unlike the five catalogue models: `tenantId` makes the global
 * hooks scope every query (deny-by-default), so a tenant sees only its own
 * proposals and another tenant's id reads as 404. `tenantId` is stamped from
 * the request context by the hooks, never read from a body. No
 * `clientFacilityId`: a proposal is provider business — a facility-bound user
 * gets DENY on it under ADR-124 § 5.
 *
 * `proposedItems` is the proposer's text, validated by the contract (P21-01)
 * and NEVER trusted as catalogue content: accepting a proposal copies nothing
 * into the global tables (Amendment 1 § 11) — the operator adds each item to a
 * draft by hand.
 *
 * NOT paranoid (a withdrawn proposal is a status); the database refuses a
 * DELETE (migration 0112's trigger), and the application role has no DELETE.
 * Associations point tenant → global (allowed, ADR-125 § 7).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import { TEMPLATE_PROPOSAL_STATUSES, type TemplateProposalStatus } from "@callibrator/contracts/states";
import { TEMPLATE_PROPOSAL_KINDS, type TemplateProposalKind } from "@callibrator/contracts/inspectionValues";
import type {
  DeviceTypeId,
  InspectionTemplateProposalId,
  InspectionTemplateVersionId,
  TenantId,
  UserId,
} from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { jsonShape, type ProposedItems } from "../utils/jsonShape.util";
import { initModel, type TypedModel } from "./initModel";

/** An InspectionTemplateProposal row. Types only: emits nothing. */
interface InspectionTemplateProposal extends Model<
  InferAttributes<InspectionTemplateProposal>,
  InferCreationAttributes<InspectionTemplateProposal>
> {
  id: CreationOptional<InspectionTemplateProposalId>;
  tenantId: TenantId;
  kind: TemplateProposalKind;
  /** NOT NULL unless `kind` is `new_device_type` (set by the operator when accepting one). */
  deviceTypeId: CreationOptional<DeviceTypeId | null>;
  /** NOT NULL iff `kind` is `new_device_type`. */
  proposedDeviceTypeName: CreationOptional<string | null>;
  /** The published version the proposer was looking at. */
  basedOnVersionId: CreationOptional<InspectionTemplateVersionId | null>;
  /** At most 100 proposed items (D-27 shape `InspectionTemplateProposal.proposedItems`). */
  proposedItems: CreationOptional<ProposedItems>;
  reason: string;
  status: CreationOptional<TemplateProposalStatus>;
  submittedBy: UserId;
  decidedBy: CreationOptional<UserId | null>;
  decidedAt: CreationOptional<Date | null>;
  /** Required on a rejection. */
  decisionNote: CreationOptional<string | null>;
  /** The draft opened (or linked) on acceptance. */
  resultingVersionId: CreationOptional<InspectionTemplateVersionId | null>;
  withdrawnAt: CreationOptional<Date | null>;
  withdrawnBy: CreationOptional<UserId | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  deviceType?: NonAttribute<ModelInstance<"DeviceType"> | null>;
  basedOnVersion?: NonAttribute<ModelInstance<"InspectionTemplateVersion"> | null>;
  resultingVersion?: NonAttribute<ModelInstance<"InspectionTemplateVersion"> | null>;
}

interface InspectionTemplateProposalStatics {
  associate: (models: Models) => void;
}

type DefineInspectionTemplateProposal = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionTemplateProposal, InspectionTemplateProposalStatics>;

/** Define the InspectionTemplateProposal model on `db`. */
const defineModel: DefineInspectionTemplateProposal = (db, DataTypes) => {
  const user = { model: "users", key: "id" };
  const version = { model: "inspection_template_versions", key: "id" };
  const InspectionTemplateProposal = initModel<InspectionTemplateProposal, InspectionTemplateProposalStatics>(
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
      kind: { type: DataTypes.ENUM(...TEMPLATE_PROPOSAL_KINDS), allowNull: false },
      deviceTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "device_types", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      proposedDeviceTypeName: { type: DataTypes.STRING(255), allowNull: true },
      basedOnVersionId: { type: DataTypes.UUID, allowNull: true, references: version, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      proposedItems: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        // D-27: an array of at most 100 objects; P21-01's contract validates each item.
        validate: { shape: jsonShape("InspectionTemplateProposal.proposedItems") },
      },
      reason: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM(...TEMPLATE_PROPOSAL_STATUSES), allowNull: false, defaultValue: "submitted" },
      submittedBy: { type: DataTypes.UUID, allowNull: false, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      decidedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decisionNote: { type: DataTypes.TEXT, allowNull: true },
      resultingVersionId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: version,
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      withdrawnAt: { type: DataTypes.DATE, allowNull: true },
      withdrawnBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
    },
    {
      tableName: "inspection_template_proposals",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionTemplateProposal",
      sequelize: db,
    },
  );

  InspectionTemplateProposal.associate = (models: Models): void => {
    // Tenant → global (allowed, ADR-125 § 7). None of the targets has a defaultScope;
    // a reader still says `required: false` — each reference may be NULL.
    InspectionTemplateProposal.belongsTo(models.DeviceType, {
      foreignKey: "deviceTypeId",
      as: "deviceType",
      onDelete: "RESTRICT",
    });
    InspectionTemplateProposal.belongsTo(models.InspectionTemplateVersion, {
      foreignKey: "basedOnVersionId",
      as: "basedOnVersion",
      onDelete: "RESTRICT",
    });
    InspectionTemplateProposal.belongsTo(models.InspectionTemplateVersion, {
      foreignKey: "resultingVersionId",
      as: "resultingVersion",
      onDelete: "RESTRICT",
    });
  };

  return InspectionTemplateProposal;
};

export = defineModel;
