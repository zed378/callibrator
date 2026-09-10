/**
 * TenantHierarchy Model
 *
 * Materialized-path representation of the tenant tree, enabling efficient
 * ancestor/descendant/subtree queries without recursive CTEs. One row per
 * tenant that participates in a hierarchy.
 *
 * Note: this table carries a `tenantId` and is therefore subject to the global
 * tenant-isolation hooks / RLS. Cross-tenant tree traversal (a parent listing
 * children that live under different tenant ids) must run in a SUPER_ADMIN /
 * system context so the isolation filter does not hide sibling rows.
 */
const defineModel = (db, DataTypes) => {
  const TenantHierarchy = db.define(
    "TenantHierarchy",
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
      // Denormalized code of this tenant (unique key used for parent/child links).
      tenantCode: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      // Code of the parent tenant; null for a root.
      parentCode: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      // Materialized path, e.g. "/acme/acme_001". Lowercased codes joined by "/".
      path: {
        type: DataTypes.STRING(1024),
        allowNull: false,
      },
      depth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "tenant_hierarchies",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"], unique: true },
        { fields: ["tenant_code"], unique: true },
        { fields: ["parent_code"] },
        { fields: ["path"] },
      ],
    },
  );

  TenantHierarchy.associate = (models) => {
    TenantHierarchy.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  return TenantHierarchy;
};

module.exports = defineModel;
