/**
 * InspectionSessionSignature Model — an electronic signature on an IPM report: the performer's
 * (authorship) or the IPSRS countersignature (review) (P20-04; ADR-126 Amendment 2 § 5 – § 6; spec
 * MEMORY/specs/P19-06-ipm-report-document.md § 4.2).
 *
 * Append-only, for every role (migration 0127's `inspection_session_signatures_append_only`): a
 * signature is inserted only on a submitted, effective, captured session whose stored content hash
 * it carries; a countersignature only after the performer's and never by the submitter or the
 * performer; nothing is ever updated or deleted — except the facility column, under a device move
 * (the composite key `(tenant_id, client_facility_id, session_id)` cascades it). The application
 * role has SELECT and INSERT only.
 *
 * TENANT- and FACILITY-scoped (the session's facility, filled on insert); nullable here and without
 * `references`. NOT paranoid, NO defaultScope, no `updated_at`; no index declared (all in 0126).
 * `ipAddress` / `userAgent` are never returned by any contract.
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import {
  INSPECTION_SIGNATURE_AUTH_METHODS,
  INSPECTION_SIGNATURE_KINDS,
  INSPECTION_SIGNATURE_MEANINGS,
  type InspectionSignatureAuthMethod,
  type InspectionSignatureKind,
  type InspectionSignatureMeaning,
} from "@callibrator/contracts/inspectionValues";
import { jsonShape, type IpmPersonSnapshot } from "../utils/jsonShape.util";
import type { ClientFacilityId, InspectionSessionId, InspectionSessionSignatureId, TenantId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An InspectionSessionSignature row. Types only: emits nothing. */
interface InspectionSessionSignature extends Model<
  InferAttributes<InspectionSessionSignature>,
  InferCreationAttributes<InspectionSessionSignature>
> {
  id: CreationOptional<InspectionSessionSignatureId>;
  tenantId: TenantId;
  clientFacilityId: CreationOptional<ClientFacilityId>;
  sessionId: InspectionSessionId;
  kind: InspectionSignatureKind;
  signerId: UserId;
  /** JSONB, D-27 shape `InspectionSessionSignature.signerSnapshot` — no e-mail, phone or id (FT-15). */
  signerSnapshot: IpmPersonSnapshot;
  meaning: InspectionSignatureMeaning;
  authMethod: InspectionSignatureAuthMethod;
  documentHash: string;
  signedAt: CreationOptional<Date>;
  ipAddress: CreationOptional<string | null>;
  userAgent: CreationOptional<string | null>;
  createdAt: CreationOptional<Date>;
}

interface InspectionSessionSignatureStatics {
  associate: (models: Models) => void;
}

type DefineInspectionSessionSignature = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionSessionSignature, InspectionSessionSignatureStatics>;

/** Define the InspectionSessionSignature model on `db`. */
const defineModel: DefineInspectionSessionSignature = (db, DataTypes) => {
  const InspectionSessionSignature = initModel<InspectionSessionSignature, InspectionSessionSignatureStatics>(
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
      // NOT NULL in the database (0126); filled from the session on insert.
      clientFacilityId: { type: DataTypes.UUID, allowNull: true },
      // The composite key (tenant_id, client_facility_id, session_id) is the migration's.
      sessionId: { type: DataTypes.UUID, allowNull: false },
      kind: { type: DataTypes.ENUM(...INSPECTION_SIGNATURE_KINDS), allowNull: false },
      signerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      signerSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        validate: { shape: jsonShape("InspectionSessionSignature.signerSnapshot") },
      },
      meaning: { type: DataTypes.ENUM(...INSPECTION_SIGNATURE_MEANINGS), allowNull: false },
      authMethod: { type: DataTypes.ENUM(...INSPECTION_SIGNATURE_AUTH_METHODS), allowNull: false },
      documentHash: { type: DataTypes.CHAR(64), allowNull: false },
      signedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      ipAddress: { type: DataTypes.STRING(45), allowNull: true },
      userAgent: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: "inspection_session_signatures",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "InspectionSessionSignature",
      sequelize: db,
    },
  );

  InspectionSessionSignature.associate = (models: Models): void => {
    InspectionSessionSignature.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    // Composite in the database (0126): no single-column key from sync.
    InspectionSessionSignature.belongsTo(models.InspectionSession, { foreignKey: "sessionId", as: "session", constraints: false });
  };

  return InspectionSessionSignature;
};

export = defineModel;
