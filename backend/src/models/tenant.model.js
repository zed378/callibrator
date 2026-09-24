/**
 * Tenant Model
 *
 * Represents an organization/entity with plan and settings.
 * Multi-tenant isolation with shared infrastructure.
 */

const { Op } = require("sequelize");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");

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
      // Tenant logo filename, stored under /uploads/public/tenant/<logo> and served as
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
      // ---- Lifecycle (services/tenantLifecycle.service.js; migration 0023) ----
      // The service always wrote these, but they were not attributes, so
      // Sequelize dropped every one of them without a word and the scheduled
      // grace-period query filtered on a column that did not exist (W-01).
      // Columns are snake_case via `underscored: true`.
      /** Why the tenant was suspended (operator-entered free text). */
      suspensionReason: { type: DataTypes.TEXT, allowNull: true },
      suspendedAt: { type: DataTypes.DATE, allowNull: true },
      /** The user who suspended it. No FK: the record outlives the user. */
      suspendedBy: { type: DataTypes.UUID, allowNull: true },
      /** A suspended tenant past this instant is offboarded by the scheduler. */
      gracePeriodExpiresAt: { type: DataTypes.DATE, allowNull: true },
      offboardedAt: { type: DataTypes.DATE, allowNull: true },
      /** Data is held until this instant; only then may it be hard-deleted. */
      offboardRetentionExpiresAt: { type: DataTypes.DATE, allowNull: true },
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
        // NOT declared here: (status, grace_period_expires_at), the scheduler's
        // index. db.sync() adds a model's missing indexes to an EXISTING table
        // and runs before migrations — on an upgraded database it would index
        // a column 0023 has not added yet and refuse the boot. 0023 creates it.
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
   * A-125 (ADR-051 Q-14) — the reserved PLATFORM tenant is not a customer.
   *
   * Every Tenant query — findAll/findOne/findByPk, count, findAndCountAll, a
   * bulk update or destroy — is AND-ed with `id <> PLATFORM_TENANT_ID` unless
   * it passes `includePlatformTenant: true` (the seed and migration 0034 do;
   * nothing on a request path should). So it is absent from every listing,
   * count and selection screen; the tenant API answers 404 for it, exactly as
   * for an id that does not exist; the x-tenant-id resolution cannot select
   * it; and a bulk suspend or offboard sweep cannot reach it.
   *
   * A hook, not the defaultScope: a scope's `where` is merged key by key and
   * the query's own key wins (`findByPk` is `where: { id }`), and `unscoped()`
   * drops it. A hook runs after the scope is injected and wraps whatever
   * `where` it finds, so no key in the query can override it.
   *
   * Not covered, deliberately: an INCLUDE of Tenant from another model (hooks
   * fire for the root model only). A row that references PLATFORM — an audit
   * row — may still show it by include; that is a reference, not a listing.
   */
  const excludePlatformTenant = (options) => {
    if (options && options.includePlatformTenant === true) {return;}
    const notPlatform = { id: { [Op.ne]: PLATFORM_TENANT_ID } };
    options.where =
      options.where === undefined || options.where === null
        ? notPlatform
        : { [Op.and]: [options.where, notPlatform] };
  };
  Tenant.addHook("beforeFind", "excludePlatformTenant", excludePlatformTenant);
  Tenant.addHook("beforeCount", "excludePlatformTenant", excludePlatformTenant);
  Tenant.addHook("beforeBulkUpdate", "excludePlatformTenant", excludePlatformTenant);
  Tenant.addHook("beforeBulkDestroy", "excludePlatformTenant", excludePlatformTenant);

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
    // `isDeleted` is the ATTRIBUTE (column is_deleted via underscored).
    // Model.update intersects its values with attribute names, so the former
    // `{ is_deleted: false }` was dropped and nothing was written (D-07).
    // unscoped(): the defaultScope pins isDeleted = false, which a restore
    // must not inherit; paranoid and the global tenant hooks still apply.
    return this.unscoped().update(
      { isDeleted: false },
      { where: { id, isDeleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Tenant.associate = (models) => {
    // The foreign key is the ATTRIBUTE (tenantId), never the column name
    // ("tenant_id"): the column name made Sequelize add a second, nullable
    // attribute that sync() built as nullable + ON DELETE SET NULL (A-88).
    // RESTRICT matches the child model and migration 0030 (ADR-051 Q-16).
    // Tenant -> Users
    Tenant.hasMany(models.User, {
      foreignKey: "tenantId",
      as: "users",
      onDelete: "RESTRICT",
    });
    // Tenant -> Warehouses
    Tenant.hasMany(models.Warehouse, {
      foreignKey: "tenantId",
      as: "warehouses",
      onDelete: "RESTRICT",
    });
    // Tenant -> StorageLocation
    Tenant.hasMany(models.StorageLocation, {
      foreignKey: "tenantId",
      as: "locations",
      onDelete: "RESTRICT",
    });
    // Tenant -> Stock
    Tenant.hasMany(models.Stock, {
      foreignKey: "tenantId",
      as: "stocks",
      onDelete: "RESTRICT",
    });
    // Tenant -> StockTransfer
    Tenant.hasMany(models.StockTransfer, {
      foreignKey: "tenantId",
      as: "transfers",
      onDelete: "RESTRICT",
    });
    // Tenant -> StockAdjustment
    Tenant.hasMany(models.StockAdjustment, {
      foreignKey: "tenantId",
      as: "adjustments",
      onDelete: "RESTRICT",
    });
    // Tenant -> StockOpname
    Tenant.hasMany(models.StockOpname, {
      foreignKey: "tenantId",
      as: "opnames",
      onDelete: "RESTRICT",
    });
    // Tenant -> CalibrationDevice
    Tenant.hasMany(models.CalibrationDevice, {
      foreignKey: "tenantId",
      as: "calibrationDevices",
      onDelete: "RESTRICT",
    });
  };

  return Tenant;
};

module.exports = defineModel;
