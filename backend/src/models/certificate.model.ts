/**
 * Certificate Model
 *
 * Calibration certificates issued for devices after successful calibration.
 * Supports digital signatures and compliance tracking (ISO 17025, KARS, SNARS).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from certificate.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
  type Op,
  type SaveOptions,
  type Sequelize as SequelizeClass,
} from "sequelize";
import type { ClientFacilityId, TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";
import { CERTIFICATE_STATE, CERTIFICATE_STATUSES } from "@callibrator/contracts/states";
import { newVerificationToken } from "../utils/certificateVerificationToken";
import { jsonShape, type CertificateSignedSnapshot } from "../utils/jsonShape.util";

// Certificate status constants (P9-05: the one list is @callibrator/contracts/states).
const STATUS = CERTIFICATE_STATE;

// Certificate type constants
const CERTIFICATE_TYPES = {
  CALIBRATION: "calibration",
  MAINTENANCE: "maintenance",
  VERIFICATION: "verification",
} as const;

/** The barrel, as the two statics read it: the model, and `Sequelize` (whose static `Op` the typings omit). */
interface CertificateModels {
  Certificate: TypedModel<Certificate, CertificateStatics>;
  Sequelize: typeof SequelizeClass & { Op: typeof Op };
}

type CertificateSaveOptions = SaveOptions<InferAttributes<Certificate>>;

/** A Certificate row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Certificate extends Model<
  InferAttributes<Certificate>,
  InferCreationAttributes<Certificate>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  calibrationRecordId: string | null;
  deviceId: string;

  /**
   * P20-07 (ADR-124 Am. 2 and Am. 3): the device's client facility, always. NOT NULL in the
   * database (migration 0120) with the composite foreign key `(tenant_id, client_facility_id,
   * device_id)` → calibration_devices `(tenant_id, client_facility_id, id)` ON UPDATE CASCADE — a
   * row can name no other facility than its device's, and a device move carries it along. Optional
   * on create: the database fills it from the device (Am. 3). Never changed except by that
   * cascade under `callibrator.facility_move` (P21-09). No index or key declared here (ADR-100 Am. 3).
   */
  clientFacilityId: CreationOptional<ClientFacilityId>;
  certificateNumber: string;
  type: CreationOptional<
    (typeof CERTIFICATE_TYPES)[keyof typeof CERTIFICATE_TYPES] | null
  >;
  status: CreationOptional<(typeof STATUS)[keyof typeof STATUS] | null>;
  calibratedBy: UserId | null;
  approvedBy: UserId | null;
  /**
   * ADR-101: who moved the certificate draft -> pending_approval. Separation of
   * duties: neither this user nor `createdBy` may approve it.
   */
  submittedBy: UserId | null;
  signedBy: UserId | null;
  digitalSignature: string | null;
  digitalSignatureKeyId: string | null;
  signedAt: Date | null;
  issueDate: Date | null;
  validUntil: Date | null;
  standard: string | null;
  summary: string | null;
  conditions: string | null;
  notes: string | null;
  filePath: string | null;
  /** BIGINT: node-postgres returns it as a string. */
  fileSize: string | number | null;
  /**
   * A-293 (ADR-100): the secret the QR code carries; it unlocks the full
   * public verification verdict. Generated on create, never chosen by a caller.
   */
  verificationToken: CreationOptional<string>;
  /**
   * ADR-107 (Q-50): the issuer, instrument and people exactly as printed at
   * signing (migration 0103). Null for a certificate not signed yet, or signed
   * before ADR-107 — nothing is back-filled; those stay v2.
   */
  signedSnapshot: CertificateSignedSnapshot | null;
  createdBy: UserId | null;
  updatedBy: UserId | null;
  deletedBy: UserId | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  calibrationRecord?: NonAttribute<ModelInstance<"CalibrationRecord">>;
  device?: NonAttribute<ModelInstance<"CalibrationDevice">>;
  calibratedByUser?: NonAttribute<ModelInstance<"User">>;
  approvedByUser?: NonAttribute<ModelInstance<"User">>;
  signedByUser?: NonAttribute<ModelInstance<"User">>;

  /** DRAFT -> PENDING_APPROVAL; throws on any other status (a 409 upstream). */
  submitForApproval(options?: CertificateSaveOptions): Promise<void>;
  /** PENDING_APPROVAL -> APPROVED. */
  approve(options?: CertificateSaveOptions): Promise<void>;
  /** APPROVED -> SIGNED, recording the signature. */
  sign(
    signatureData: string,
    keyId: string,
    options?: CertificateSaveOptions,
  ): Promise<void>;
  /** Any -> REVOKED (idempotent). */
  revoke(reason: string, options?: CertificateSaveOptions): Promise<void>;
}

interface CertificateStatics {
  associate: (models: Models) => void;
  generateCertificateNumber: (
    tenantCode: string | null | undefined,
    models?: CertificateModels | null,
  ) => Promise<string>;
  countByStatus: (
    tenantId: TenantId,
    models?: CertificateModels | null,
  ) => Promise<Record<string, number>>;
  STATUS: typeof STATUS;
  CERTIFICATE_TYPES: typeof CERTIFICATE_TYPES;
}

type DefineCertificate = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Certificate, CertificateStatics>;

/** Define the Certificate model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineCertificate = (db, DataTypes) => {
  const Certificate = initModel<Certificate, CertificateStatics>(
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
      // Reference links
      calibrationRecordId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "calibration_records", key: "id" },
      },
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "calibration_devices", key: "id" },
      },
      // P20-07: NOT NULL in the database; allowNull here because the database fills it from the
      // device on insert (ADR-124 Am. 3). The composite key lives in the migration.
      clientFacilityId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Certificate details
      certificateNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      type: {
        type: DataTypes.ENUM("calibration", "maintenance", "verification"),
        defaultValue: "calibration",
      },
      status: {
        type: DataTypes.ENUM(...CERTIFICATE_STATUSES),
        defaultValue: "draft",
      },
      // Signatures
      // Who calibrated, approved and signed: RESTRICT (ADR-051 Q-16) — a
      // hard delete of the user is refused rather than erasing the attestation.
      calibratedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      approvedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      // Separation of duties (ADR-101): the submitter of a certificate may not
      // approve it. Column added by migration 0095; ON DELETE RESTRICT, as
      // approvedBy and signedBy.
      submittedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      signedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      // Digital signature
      digitalSignature: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      digitalSignatureKeyId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Dates
      issueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      validUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Compliance
      standard: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "Applicable standard (e.g., ISO 17025, KARS, SNARS)",
      },
      // Content
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      conditions: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Conditions or limitations of the certificate",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // File storage
      filePath: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      fileSize: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      // A-293 (ADR-100): 24 CSPRNG bytes, base64url. Column added, back-filled
      // and made NOT NULL by migration 0096, which also owns its UNIQUE index
      // (named there) — not declared here, because
      // db.sync() runs before the migrations (D-13). The default covers
      // bulkCreate; the create hooks below replace any value a caller passed.
      verificationToken: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: newVerificationToken,
      },
      // ADR-107 (Q-50): written once, in the sign transaction, by
      // certificateDocument.service#captureSignedSnapshot. JSONB with a D-27 shape.
      signedSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("Certificate.signedSnapshot") },
      },
      // Audit
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      deletedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
    },
    {
      tableName: "certificates",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["certificate_number"], unique: true },
        { fields: ["device_id"] },
        { fields: ["calibration_record_id"] },
        { fields: ["status"] },
        { fields: ["issue_date"] },
      ],
      modelName: "Certificate",
      sequelize: db,
    },
  );

  /**
   * Static method to generate a unique certificate number.
   * Format: CERT-{YYYYMMDD}-{sequence}
   * @param {string} tenantCode - Tenant code for prefix
   * @param {object} models - The models object
   * @returns {string} Generated certificate number
   */
  Certificate.generateCertificateNumber = async (
    tenantCode: string | null | undefined,
    models: CertificateModels | null = null,
  ): Promise<string> => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    // `||`, as built: an EMPTY tenant code also falls back to "T".
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the empty-string fallback is the as-built behaviour
    const prefix = `CERT-${dateStr}-${tenantCode || "T"}`;

    // Get the last certificate number for today
    // The ESLint indent rule and Prettier disagree on this ternary; the original layout satisfies ESLint.
    // prettier-ignore
    const lastCertificate = models
      ? await models.Certificate.findOne({
        where: {
          certificateNumber: {
            [models.Sequelize.Op.like]: `${prefix}%`,
          },
        },
        order: [["certificateNumber", "DESC"]],
        // Include soft-deleted rows: certificate_number is UNIQUE and the
        // constraint still covers paranoid-deleted certificates, so the next
        // sequence must step past them to avoid a duplicate-key error.
        paranoid: false,
        // Every tenant's rows (D-40): the constraint is platform-wide — the
        // number is the public verification key — so the sequence must step
        // past a number another tenant holds under the same prefix. Only the
        // highest number is read, and it is never returned to the caller.
        skipTenantScope: true,
        raw: true,
      })
      : null;

    let sequence = 1;
    if (lastCertificate) {
      const parts = lastCertificate.certificateNumber.split("-");
      // split() always yields at least one element.
      const lastSeq = parseInt(parts[parts.length - 1] as string, 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, "0")}`;
  };

  /**
   * Static method to count certificates by status for a tenant.
   * @param {string} tenantId - Tenant ID
   * @param {object} models - The models object
   * @returns {Object} Count by status
   */
  Certificate.countByStatus = async (
    tenantId: TenantId,
    models: CertificateModels | null = null,
  ): Promise<Record<string, number>> => {
    if (!models) {
      return {};
    }

    // raw: true with a COUNT(...) column: rows are plain { status, count } objects, not instances.
    const results = (await models.Certificate.findAll({
      where: { tenantId },
      attributes: [
        "status",
        [models.Sequelize.fn("COUNT", models.Sequelize.col("id")), "count"],
      ],
      group: ["status"],
      raw: true,
    })) as unknown as { status: string; count: string }[];

    return results.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = parseInt(row.count, 10);
      return acc;
    }, {});
  };

  /**
   * Instance method to submit a DRAFT certificate for approval.
   * Transitions DRAFT -> PENDING_APPROVAL so approve() becomes reachable.
   * @param {object} [options] - passed to save(), e.g. { transaction } (A-41)
   * @returns {Promise<void>}
   */
  Certificate.prototype.submitForApproval = async function (
    this: Certificate,
    options?: CertificateSaveOptions,
  ): Promise<void> {
    if (this.status !== STATUS.DRAFT) {
      throw new Error(
        `Cannot submit certificate for approval with status: ${String(this.status)}`,
      );
    }
    this.status = STATUS.PENDING_APPROVAL;
    await this.save(options);
  };

  /**
   * Instance method to approve the certificate.
   * @param {object} [options] - passed to save(), e.g. { transaction } (A-41)
   * @returns {Promise<void>}
   */
  Certificate.prototype.approve = async function (
    this: Certificate,
    options?: CertificateSaveOptions,
  ): Promise<void> {
    if (this.status !== STATUS.PENDING_APPROVAL) {
      throw new Error(
        `Cannot approve certificate with status: ${String(this.status)}`,
      );
    }
    this.status = STATUS.APPROVED;
    await this.save(options);
  };

  /**
   * Instance method to sign the certificate digitally.
   * @param {string} signatureData - Digital signature data
   * @param {string} keyId - Key ID used for signing
   * @param {object} [options] - passed to save(), e.g. { transaction } (A-41)
   * @returns {Promise<void>}
   */
  Certificate.prototype.sign = async function (
    this: Certificate,
    signatureData: string,
    keyId: string,
    options?: CertificateSaveOptions,
  ): Promise<void> {
    if (this.status !== STATUS.APPROVED) {
      throw new Error(
        `Cannot sign certificate with status: ${String(this.status)}. Must be approved first.`,
      );
    }
    this.digitalSignature = signatureData;
    this.digitalSignatureKeyId = keyId;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    this.signedBy = this.signedBy || this.approvedBy;
    this.status = STATUS.SIGNED;
    this.signedAt = new Date();
    await this.save(options);
  };

  /**
   * Instance method to revoke the certificate.
   * @param {string} reason - Reason for revocation
   * @param {object} [options] - passed to save(), e.g. { transaction } (A-41)
   * @returns {Promise<void>}
   */
  Certificate.prototype.revoke = async function (
    this: Certificate,
    reason: string,
    options?: CertificateSaveOptions,
  ): Promise<void> {
    if (this.status === STATUS.REVOKED) {
      return; // Already revoked
    }
    this.status = STATUS.REVOKED;
    this.notes = this.notes
      ? `${this.notes}\n\nREVOKED: ${reason}`
      : `REVOKED: ${reason}`;
    await this.save(options);
  };

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  Certificate.associate = (models: Models): void => {
    // Certificate -> Tenant
    Certificate.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // Certificate -> CalibrationRecord
    Certificate.belongsTo(models.CalibrationRecord, {
      foreignKey: "calibrationRecordId",
      as: "calibrationRecord",
      onDelete: "RESTRICT",
    });
    // Certificate -> Device
    Certificate.belongsTo(models.CalibrationDevice, {
      foreignKey: "deviceId",
      as: "device",
      onDelete: "RESTRICT",
    });
    // Certificate -> CalibratedBy (User)
    Certificate.belongsTo(models.User, {
      foreignKey: "calibratedBy",
      as: "calibratedByUser",
      onDelete: "RESTRICT",
    });
    // Certificate -> ApprovedBy (User)
    Certificate.belongsTo(models.User, {
      foreignKey: "approvedBy",
      as: "approvedByUser",
      onDelete: "RESTRICT",
    });
    // Certificate -> SignedBy (User)
    Certificate.belongsTo(models.User, {
      foreignKey: "signedBy",
      as: "signedByUser",
      onDelete: "RESTRICT",
    });
  };

  // A-293 (ADR-100): the verification token is the server's, never the
  // caller's — a value in create()/bulkCreate() is replaced, whatever path
  // built it. (bulkCreate runs per-row hooks only with individualHooks, so it
  // has its own hook.)
  Certificate.addHook("beforeCreate", "verificationToken", (instance: Certificate) => {
    instance.verificationToken = newVerificationToken();
  });
  Certificate.addHook("beforeBulkCreate", "verificationToken", (instances: Certificate[]) => {
    for (const instance of instances) {
      instance.verificationToken = newVerificationToken();
    }
  });

  // Attach constants to the model
  Certificate.STATUS = STATUS;
  Certificate.CERTIFICATE_TYPES = CERTIFICATE_TYPES;

  return Certificate;
};

export = defineModel;
