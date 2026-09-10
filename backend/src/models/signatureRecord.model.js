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
        onDelete: "CASCADE",
      },
      workflowId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "signature_workflows", key: "id" },
        onDelete: "CASCADE",
      },
      workflowStepId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "signature_workflow_steps", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      signatureHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
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
      foreignKey: "tenant_id",
      as: "tenant",
    });
    SignatureRecord.belongsTo(models.SignatureWorkflow, {
      foreignKey: "workflow_id",
      as: "workflow",
    });
    SignatureRecord.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "signer",
    });
  };

  return SignatureRecord;
};

module.exports = defineModel;
