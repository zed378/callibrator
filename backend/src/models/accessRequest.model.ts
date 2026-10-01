/**
 * AccessRequest Model — a hospital's or lab's request for access (P10-05,
 * ADR-098 §6; spec MEMORY/specs/P10-05-request-access.md).
 *
 * Submitted by anyone through the public intake (`POST /access-requests`),
 * worked by the super admin in the platform queue (`/admin/access-requests`).
 * Approval creates the tenant and its first administrator; the administrator
 * sets their own password through a single-use invitation link (P10-15).
 *
 * NOT tenant-scoped, on purpose: a request precedes any tenant, like `tenants`
 * itself. The link to the tenant approval created is `provisionedTenantId` and
 * is deliberately NOT named `tenantId` — that attribute would make the global
 * hooks scope the table (`tenantScope.util#tenantKeyOf`), and a pending
 * request belongs to no tenant. Only the super admin reaches it.
 *
 * NOT paranoid: a request is not evidence of a regulated act. The retention
 * sweep (dataRetention.service) deletes rejected, spam and expired rows
 * outright 12 months after their decision (Q-42).
 *
 * The table, its ENUM types, its CHECK constraint and its indexes are created
 * by migration 0099; the indexes are not declared here, because db.sync()
 * runs BEFORE the migrations at boot (D-13, as 0093).
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
import {
  ACCESS_REQUEST_STATUSES,
  DEVICE_COUNT_BANDS,
  FACILITY_TYPES,
  REQUEST_LOCALES,
  type AccessRequestStatus,
  type DeviceCountBand,
  type FacilityType,
  type RequestLocale,
} from "../constants/accessRequest";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An AccessRequest row (attributes and included associations). Types only: emits nothing. */
interface AccessRequest extends Model<InferAttributes<AccessRequest>, InferCreationAttributes<AccessRequest>> {
  id: CreationOptional<string>;
  organisationName: string;
  facilityType: FacilityType;
  city: string;
  deviceCountBand: DeviceCountBand;
  /** Personal data. */
  contactName: string;
  contactRole: string | null;
  /** Personal data; stored lower-cased. */
  workEmail: string;
  /** Personal data; E.164. */
  whatsapp: string;
  needs: string | null;
  locale: RequestLocale;
  consentVersion: string;
  consentedAt: Date;
  status: CreationOptional<AccessRequestStatus>;
  adminUserId: CreationOptional<string | null>;
  decidedBy: CreationOptional<string | null>;
  decidedAt: CreationOptional<Date | null>;
  decisionNote: CreationOptional<string | null>;
  provisionedTenantId: CreationOptional<string | null>;
  /** sha256 of the P10-15 invitation token; null once accepted or never issued. */
  invitationTokenHash: CreationOptional<string | null>;
  invitationExpiresAt: CreationOptional<Date | null>;
  invitationSentAt: CreationOptional<Date | null>;
  invitationAcceptedAt: CreationOptional<Date | null>;
  /** sha256(pepper + ip): for abuse review; the raw address is never stored. */
  sourceIpHash: string;
  userAgent: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  decider?: NonAttribute<ModelInstance<"User"> | null>;
}

interface AccessRequestStatics {
  associate: (models: Models) => void;
}

type DefineAccessRequest = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<AccessRequest, AccessRequestStatics>;

/** Define the AccessRequest model on `db`. */
const defineModel: DefineAccessRequest = (db, DataTypes) => {
  const AccessRequest = initModel<AccessRequest, AccessRequestStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      organisationName: { type: DataTypes.STRING(160), allowNull: false },
      facilityType: { type: DataTypes.ENUM(...FACILITY_TYPES), allowNull: false },
      city: { type: DataTypes.STRING(80), allowNull: false },
      deviceCountBand: { type: DataTypes.ENUM(...DEVICE_COUNT_BANDS), allowNull: false },
      contactName: { type: DataTypes.STRING(120), allowNull: false },
      contactRole: { type: DataTypes.STRING(80), allowNull: true },
      workEmail: { type: DataTypes.STRING(254), allowNull: false },
      whatsapp: { type: DataTypes.STRING(20), allowNull: false },
      needs: { type: DataTypes.TEXT, allowNull: true },
      locale: { type: DataTypes.ENUM(...REQUEST_LOCALES), allowNull: false },
      consentVersion: { type: DataTypes.STRING(32), allowNull: false },
      consentedAt: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.ENUM(...ACCESS_REQUEST_STATUSES), allowNull: false, defaultValue: "pending" },
      adminUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      decidedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decisionNote: { type: DataTypes.STRING(1000), allowNull: true },
      // NOT declared as a model reference: every model foreign key to
      // `tenants` is the Q-16 tenant column (RESTRICT, 0030), which this is
      // not. Migration 0099 adds the constraint (ON DELETE SET NULL).
      provisionedTenantId: { type: DataTypes.UUID, allowNull: true },
      invitationTokenHash: { type: DataTypes.CHAR(64), allowNull: true },
      invitationExpiresAt: { type: DataTypes.DATE, allowNull: true },
      invitationSentAt: { type: DataTypes.DATE, allowNull: true },
      invitationAcceptedAt: { type: DataTypes.DATE, allowNull: true },
      sourceIpHash: { type: DataTypes.CHAR(64), allowNull: false },
      userAgent: { type: DataTypes.STRING(256), allowNull: true },
    },
    {
      tableName: "access_requests",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "AccessRequest",
      sequelize: db,
    },
  );

  AccessRequest.associate = (models: Models): void => {
    // `User` carries a defaultScope: an include of it must say
    // `required: false` (CLAUDE.md trap A-75) — the decider may be gone. The
    // provisioned tenant has NO association on purpose: every association to
    // Tenant is a Q-16 tenant column (tenantForeignKeys.a88); the service
    // reads it by id.
    AccessRequest.belongsTo(models.User, { foreignKey: "decidedBy", as: "decider", constraints: false });
  };

  return AccessRequest;
};

export = defineModel;
