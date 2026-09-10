/**
 * CustomDomain Model
 *
 * Per-tenant custom domains / vanity subdomains. A tenant may register multiple
 * domains; one may be flagged isDefault. Domain ownership is verified via a DNS
 * TXT record before a domain becomes active.
 */
const defineModel = (db, DataTypes) => {
  const CustomDomain = db.define(
    "CustomDomain",
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
      domain: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      domainType: {
        type: DataTypes.ENUM("custom", "subdomain", "vanity"),
        allowNull: false,
        defaultValue: "subdomain",
      },
      status: {
        type: DataTypes.ENUM(
          "pending_verification",
          "active",
          "verification_failed",
          "deleting",
          "deleted",
        ),
        allowNull: false,
        defaultValue: "pending_verification",
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sslEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      verificationToken: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      verifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastCheckedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "custom_domains",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["domain"], unique: true },
        { fields: ["status"] },
      ],
    },
  );

  CustomDomain.associate = (models) => {
    CustomDomain.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  return CustomDomain;
};

module.exports = defineModel;
