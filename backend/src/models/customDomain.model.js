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
      // A-223 — NOT unique on its own. It was, globally: a removed domain is a
      // soft delete (status `deleted`, kept for the audit trail), so removing a
      // domain and adding it again — by the same tenant or its new owner — hit
      // the index and answered 500. Uniqueness is two partial indexes, created
      // by migration 0070 (a model cannot declare an expression index that
      // db.sync() would build before the migrations run):
      //   custom_domains_domain_active_uq        (lower(domain)) WHERE status = 'active'
      //   custom_domains_tenant_domain_live_uq   (tenant_id, lower(domain)) WHERE status <> 'deleted'
      // Stored lower-case (customDomains.service#addDomain).
      domain: {
        type: DataTypes.STRING(255),
        allowNull: false,
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
        { fields: ["status"] },
      ],
    },
  );

  CustomDomain.associate = (models) => {
    CustomDomain.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return CustomDomain;
};

module.exports = defineModel;
