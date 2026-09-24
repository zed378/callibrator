/**
 * Certificate Model
 *
 * Calibration certificates issued for devices after successful calibration.
 * Supports digital signatures and compliance tracking (ISO 17025, KARS, SNARS).
 */

// Certificate status constants
const STATUS = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  SIGNED: "signed",
  REVOKED: "revoked",
};

// Certificate type constants
const CERTIFICATE_TYPES = {
  CALIBRATION: "calibration",
  MAINTENANCE: "maintenance",
  VERIFICATION: "verification",
};

/**
 * Define the Certificate model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Certificate = db.define(
    "Certificate",
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
        type: DataTypes.ENUM(
          "draft",
          "pending_approval",
          "approved",
          "signed",
          "revoked",
        ),
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
    },
  );

  /**
   * Static method to generate a unique certificate number.
   * Format: CERT-{YYYYMMDD}-{sequence}
   * @param {string} tenantCode - Tenant code for prefix
   * @param {object} models - The models object
   * @returns {string} Generated certificate number
   */
  Certificate.generateCertificateNumber = async (tenantCode, models = null) => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `CERT-${dateStr}-${tenantCode || "T"}`;

    // Get the last certificate number for today
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
      const lastSeq = parseInt(parts[parts.length - 1], 10);
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
  Certificate.countByStatus = async (tenantId, models = null) => {
    if (!models) {
      return {};
    }

    const results = await models.Certificate.findAll({
      where: { tenantId },
      attributes: [
        "status",
        [models.Sequelize.fn("COUNT", models.Sequelize.col("id")), "count"],
      ],
      group: ["status"],
      raw: true,
    });

    return results.reduce((acc, row) => {
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
  Certificate.prototype.submitForApproval = async function (options) {
    if (this.status !== STATUS.DRAFT) {
      throw new Error(
        `Cannot submit certificate for approval with status: ${this.status}`,
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
  Certificate.prototype.approve = async function (options) {
    if (this.status !== STATUS.PENDING_APPROVAL) {
      throw new Error(`Cannot approve certificate with status: ${this.status}`);
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
  Certificate.prototype.sign = async function (signatureData, keyId, options) {
    if (this.status !== STATUS.APPROVED) {
      throw new Error(
        `Cannot sign certificate with status: ${this.status}. Must be approved first.`,
      );
    }
    this.digitalSignature = signatureData;
    this.digitalSignatureKeyId = keyId;
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
  Certificate.prototype.revoke = async function (reason, options) {
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
   * @param {object} models - The aggregated models object
   */
  Certificate.associate = (models) => {
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

  // Attach constants to the model
  Certificate.STATUS = STATUS;
  Certificate.CERTIFICATE_TYPES = CERTIFICATE_TYPES;

  return Certificate;
};

module.exports = defineModel;
