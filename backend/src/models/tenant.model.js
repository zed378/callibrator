/**
 * Tenant Model
 *
 * Represents an organization/entity with plan and settings.
 * Multi-tenant isolation with shared infrastructure.
 */

/**
 * Define the Tenant model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Tenant = db.define(
    "Tenant",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      subdomain: {
        type: DataTypes.STRING(63),
        allowNull: false,
        unique: true,
        validate: {
          len: [1, 63],
          isLowercase: true,
          is: "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
        },
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
      },
      domain: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
      },
      // Tenant logo filename, stored under /uploads/tenant/<logo> and served as
      // `logoBaseUrl`. Nullable = no custom logo (frontend falls back to default).
      logo: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // Per-tenant brand color (hex, e.g. "#4f46e5"). Drives the frontend
      // `--primary` theme token at runtime. Null = default app primary.
      primaryColor: {
        type: DataTypes.STRING(9),
        allowNull: true,
      },
      plan: {
        type: DataTypes.ENUM("free", "professional", "business", "enterprise"),
        defaultValue: "free",
      },
      status: {
        type: DataTypes.ENUM("active", "suspended", "deleted"),
        defaultValue: "active",
      },
      trialEndsAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      billingCycle: {
        type: DataTypes.ENUM("monthly", "yearly"),
        defaultValue: "monthly",
      },
      billingEmail: { type: DataTypes.STRING(255), allowNull: true },
      contactName: { type: DataTypes.STRING(255), allowNull: true },
      contactEmail: { type: DataTypes.STRING(255), allowNull: true },
      contactPhone: { type: DataTypes.STRING(50), allowNull: true },
      settings: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      limitSeats: {
        type: DataTypes.INTEGER,
        defaultValue: 5,
      },
      limitStorageMb: {
        type: DataTypes.INTEGER,
        defaultValue: 10240,
      },
      code: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true,
      },
      // Parent tenant for hierarchy / sub-organizations. Null = root tenant.
      parentId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "tenants", key: "id" },
        onDelete: "SET NULL",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "tenants",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["status"] },
        { fields: ["subdomain"] },
        { fields: ["domain"] },
        { fields: ["email"] },
        { fields: ["code"], unique: true },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        where: { is_deleted: false },
      },
      scopes: {
        includeDeleted: {
          where: null,
        },
      },
    },
  );

  /**
   * Soft-delete a tenant. Sets is_deleted = true and persists.
   */
  Tenant.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted tenant by ID. Sets is_deleted = false.
   */
  Tenant.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Tenant.associate = (models) => {
    // Tenant -> Users
    Tenant.hasMany(models.User, { foreignKey: "tenant_id", as: "users" });
    // Tenant -> Warehouses
    Tenant.hasMany(models.Warehouse, {
      foreignKey: "tenant_id",
      as: "warehouses",
    });
    // Tenant -> StorageLocation
    Tenant.hasMany(models.StorageLocation, {
      foreignKey: "tenant_id",
      as: "locations",
    });
    // Tenant -> Stock
    Tenant.hasMany(models.Stock, { foreignKey: "tenant_id", as: "stocks" });
    // Tenant -> StockTransfer
    Tenant.hasMany(models.StockTransfer, {
      foreignKey: "tenant_id",
      as: "transfers",
    });
    // Tenant -> StockAdjustment
    Tenant.hasMany(models.StockAdjustment, {
      foreignKey: "tenant_id",
      as: "adjustments",
    });
    // Tenant -> StockOpname
    Tenant.hasMany(models.StockOpname, {
      foreignKey: "tenant_id",
      as: "opnames",
    });
    // Tenant -> CalibrationDevice
    Tenant.hasMany(models.CalibrationDevice, {
      foreignKey: "tenant_id",
      as: "calibrationDevices",
    });
  };

  return Tenant;
};

module.exports = defineModel;
