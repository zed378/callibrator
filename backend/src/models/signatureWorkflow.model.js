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
        onDelete: "RESTRICT",
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
      // A-170: the user who requested the signatures — set once, at creation,
      // from the authenticated actor (never the body). The completion email
      // goes to them. Nullable only for workflows created before migration
      // 0039; RESTRICT, like every other Part 11 attribution (A-149).
      requestedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
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
        // `signature_workflows_requested_by` is created by migration 0039,
        // not here: boot runs sync() BEFORE the migrations, and an index on a
        // column an existing database does not have yet fails the boot.
      ],
    },
  );

  SignatureWorkflow.associate = (models) => {
    SignatureWorkflow.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    SignatureWorkflow.hasMany(models.SignatureWorkflowStep, {
      foreignKey: "workflowId",
      as: "steps",
      onDelete: "RESTRICT",
    });
    SignatureWorkflow.hasMany(models.SignatureRecord, {
      foreignKey: "workflowId",
      as: "signatures",
      onDelete: "RESTRICT",
    });
    // A-170 — the requester. The attribute (not the column) names the key.
    SignatureWorkflow.belongsTo(models.User, {
      foreignKey: "requestedBy",
      as: "requester",
      onDelete: "RESTRICT",
    });
  };

  return SignatureWorkflow;
};

module.exports = defineModel;
