/**
 * SignatureRecord Model — an executed electronic signature (21 CFR Part 11)
 *
 * The tamper-evident record produced when a signer completes a workflow step:
 * a hash binding the document + signer + tenant, plus the authentication method,
 * IP/user-agent, and optional biometric/polygon capture. Distinct from
 * ESignatureRecord, which is the certificate module's polymorphic compliance log.
 */

const defineModel = (db, DataTypes) => {
  const SignatureRecord = db.define(
    "SignatureRecord",
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
        allowNull: true,
        comment: "Captured hand-drawn signature polygon, if any",
      },
      biometricData: {
        type: DataTypes.JSON,
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
        type: DataTypes.ENUM("signed", "revoked"),
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
    },
  );

  SignatureRecord.associate = (models) => {
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

module.exports = defineModel;
