/**
 * SignatureWorkflowStep Model — a single signer's slot in a workflow
 *
 * Steps are ordered by stepNumber; the first is `pending`, later ones `waiting`
 * until their turn. Carries tenantId so the signing path (which reads
 * step.tenantId) and the tenant-isolation hooks both stay correct.
 */

const defineModel = (db, DataTypes) => {
  const SignatureWorkflowStep = db.define(
    "SignatureWorkflowStep",
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
      stepNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      signerId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "User id of the signer, when they are an internal user",
      },
      signerEmail: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      signerName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("waiting", "pending", "signed", "declined"),
        allowNull: false,
        defaultValue: "waiting",
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: "signature_workflow_steps",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["workflow_id"] },
        { fields: ["status"] },
      ],
    },
  );

  SignatureWorkflowStep.associate = (models) => {
    SignatureWorkflowStep.belongsTo(models.SignatureWorkflow, {
      foreignKey: "workflow_id",
      as: "workflow",
    });
  };

  return SignatureWorkflowStep;
};

module.exports = defineModel;
