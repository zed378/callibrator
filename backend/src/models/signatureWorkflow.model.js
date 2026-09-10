/**
 * SignatureWorkflow Model — e-Signature routing envelope
 *
 * One signing request over a document, routed sequentially through its
 * SignatureWorkflowSteps. Tenant-scoped for isolation.
 */

const defineModel = (db, DataTypes) => {
  const SignatureWorkflow = db.define(
    "SignatureWorkflow",
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
        type: DataTypes.ENUM(
          "pending",
          "in_progress",
          "completed",
          "cancelled",
          "expired",
        ),
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
      ],
    },
  );

  SignatureWorkflow.associate = (models) => {
    SignatureWorkflow.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    SignatureWorkflow.hasMany(models.SignatureWorkflowStep, {
      foreignKey: "workflow_id",
      as: "steps",
    });
    SignatureWorkflow.hasMany(models.SignatureRecord, {
      foreignKey: "workflow_id",
      as: "signatures",
    });
  };

  return SignatureWorkflow;
};

module.exports = defineModel;
