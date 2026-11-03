/**
 * EsignatureApplication Model — one application of a personal e-signature to one document (P21-15;
 * ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 2.2).
 *
 * Binds the signer, the meaning, the instant and the SHA-256 of the document's canonical content
 * (`contentHash` under `contentScheme`), signed with the signer's personal key (`signatureValue`,
 * scheme `esig-app-v1-rsa-sha256`). `documentId` names the calibration record or certificate, and is
 * null for a `document` signed by its hash alone (the file is never uploaded). One application per
 * (document, signer, meaning) — migration 0149's partial UNIQUE.
 *
 * Append-only for every role (0149's triggers). TENANT-scoped (the hooks). The public verification
 * resolves a row by id plus a constant-time comparison of `verificationToken`, with the reviewed
 * `skipTenantScope`; the token is stored (as the IPM report's, G-R3) so the QR can be printed again.
 * `verificationToken`, `ipAddress` and `userAgent` are never returned: every route answers an explicit
 * projection (esignatureApplication.service#applicationView). They are not in SECRET_ATTRIBUTES, whose
 * names the response scan forbids in EVERY body (they are legitimate keys of other answers).
 *
 * NOT paranoid, NO defaultScope, no `updated_at`; no index declared (all in 0149, ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { EsigAuthMethod, EsigContentScheme, EsigDocumentType, EsigMeaning } from "@callibrator/contracts/esignatures";
import { jsonShape, type PersonSnapshot } from "../utils/jsonShape.util";
import type { EsignatureApplicationId, TenantId, UserEsignatureId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An EsignatureApplication row. Types only: emits nothing. */
interface EsignatureApplication extends Model<InferAttributes<EsignatureApplication>, InferCreationAttributes<EsignatureApplication>> {
  id: CreationOptional<EsignatureApplicationId>;
  tenantId: TenantId;
  esignatureId: UserEsignatureId;
  signerUserId: UserId;
  /** JSONB, D-27 shape `EsignatureApplication.signerSnapshot` — name, role, organisation; no e-mail or phone (FT-15). */
  signerSnapshot: PersonSnapshot;
  documentType: EsigDocumentType;
  documentId: string | null;
  documentTitle: string;
  meaning: EsigMeaning;
  contentHash: string;
  contentScheme: EsigContentScheme;
  authMethod: EsigAuthMethod;
  signatureValue: string;
  signedAt: Date;
  verificationToken: string;
  ipAddress: CreationOptional<string | null>;
  userAgent: CreationOptional<string | null>;
  createdAt: CreationOptional<Date>;
}

interface EsignatureApplicationStatics {
  associate: (models: Models) => void;
}

type DefineEsignatureApplication = (db: Sequelize, DataTypes: typeof DataTypesNamespace) => TypedModel<EsignatureApplication, EsignatureApplicationStatics>;

const fk = (DataTypes: typeof DataTypesNamespace, table: string) => ({
  type: DataTypes.UUID,
  allowNull: false,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** Define the EsignatureApplication model on `db`. */
const defineModel: DefineEsignatureApplication = (db, DataTypes) => {
  const EsignatureApplication = initModel<EsignatureApplication, EsignatureApplicationStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: fk(DataTypes, "tenants"),
      esignatureId: fk(DataTypes, "user_esignatures"),
      signerUserId: fk(DataTypes, "users"),
      signerSnapshot: { type: DataTypes.JSONB, allowNull: false, validate: { shape: jsonShape("EsignatureApplication.signerSnapshot") } },
      documentType: { type: DataTypes.STRING(40), allowNull: false },
      documentId: { type: DataTypes.UUID, allowNull: true },
      documentTitle: { type: DataTypes.STRING(255), allowNull: false },
      meaning: { type: DataTypes.STRING(40), allowNull: false },
      contentHash: { type: DataTypes.CHAR(64), allowNull: false },
      contentScheme: { type: DataTypes.STRING(40), allowNull: false },
      authMethod: { type: DataTypes.STRING(10), allowNull: false },
      signatureValue: { type: DataTypes.TEXT, allowNull: false },
      signedAt: { type: DataTypes.DATE, allowNull: false },
      verificationToken: { type: DataTypes.STRING(64), allowNull: false },
      ipAddress: { type: DataTypes.STRING(45), allowNull: true },
      userAgent: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: "esignature_applications",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "EsignatureApplication",
      sequelize: db,
    },
  );

  EsignatureApplication.associate = (models: Models): void => {
    EsignatureApplication.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    EsignatureApplication.belongsTo(models.UserEsignature, { foreignKey: "esignatureId", as: "esignature", onDelete: "RESTRICT" });
    EsignatureApplication.belongsTo(models.User, { foreignKey: "signerUserId", as: "signer", onDelete: "RESTRICT" });
  };

  return EsignatureApplication;
};

export = defineModel;
