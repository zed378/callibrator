// D-17 — NO tenant column, so the global tenant hooks never scope this model: it IS the tenant. Reached by id only behind ownTenantGuard / superAdminOnly (A-01).
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Tenant Model
 *
 * Represents an organization/entity with plan and settings.
 * Multi-tenant isolation with shared infrastructure.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from tenant.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
  Op,
} from "sequelize";
import { jsonShape, type TenantSettingsJson } from "../utils/jsonShape.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import type { TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

// D-27 (ADR-070): every JSON column declares its shape, validated on write.

/**
 * What the PLATFORM-exclusion hook reads and writes on the options of every Tenant
 * find, count, bulk update and bulk destroy. `includePlatformTenant` is this model's own
 * opt-in (the seed and migration 0034 pass it); every Sequelize hook's options object
 * satisfies this shape.
 */
interface PlatformExclusionOptions {
  where?: unknown;
  includePlatformTenant?: boolean;
}

/** The `plan` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const TENANT_PLANS = [
  "free",
  "professional",
  "business",
  "enterprise",
] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const TENANT_STATUSES = ["active", "suspended", "deleted"] as const;

/** The `billingCycle` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const TENANT_BILLING_CYCLES = ["monthly", "yearly"] as const;

/** A Tenant row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Tenant extends Model<
  InferAttributes<Tenant>,
  InferCreationAttributes<Tenant>
> {
  id: CreationOptional<TenantId>;
  name: string;
  /** Unique, lower-case, 1–63 of [a-z0-9-] (validated). */
  subdomain: string;
  email: string;
  domain: string | null;
  logo: string | null;
  primaryColor: string | null;
  plan: CreationOptional<(typeof TENANT_PLANS)[number] | null>;
  status: CreationOptional<(typeof TENANT_STATUSES)[number] | null>;
  trialEndsAt: CreationOptional<Date | null>;
  billingCycle: CreationOptional<(typeof TENANT_BILLING_CYCLES)[number] | null>;
  billingEmail: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /**
   * A-303 (migration 0100): the organisation's profile. ISO/IEC 17025 7.8.2
   * puts the issuing laboratory's name and address on every certificate
   * (certificateDocument.service `issuer`). Written by tenant.service#updateTenant.
   */
  description: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  /** Province / state. */
  state: string | null;
  zipCode: string | null;
  country: string | null;
  /** http(s) only (tenant.validator). */
  website: string | null;
  /** JSONB, D-27 shape `Tenant.settings`. */
  settings: CreationOptional<TenantSettingsJson | null>;
  limitSeats: CreationOptional<number | null>;
  limitStorageMb: CreationOptional<number | null>;
  code: string | null;
  /** Parent tenant (hierarchy); NULL = a root tenant. */
  parentId: TenantId | null;
  isDeleted: CreationOptional<boolean>;
  /** Lifecycle (migration 0023, tenantLifecycle.service). */
  suspensionReason: string | null;
  suspendedAt: Date | null;
  suspendedBy: UserId | null;
  gracePeriodExpiresAt: Date | null;
  offboardedAt: Date | null;
  offboardRetentionExpiresAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  users?: NonAttribute<ModelInstance<"User">[]>;
  warehouses?: NonAttribute<ModelInstance<"Warehouse">[]>;
  locations?: NonAttribute<ModelInstance<"StorageLocation">[]>;
  stocks?: NonAttribute<ModelInstance<"Stock">[]>;
  transfers?: NonAttribute<ModelInstance<"StockTransfer">[]>;
  adjustments?: NonAttribute<ModelInstance<"StockAdjustment">[]>;
  opnames?: NonAttribute<ModelInstance<"StockOpname">[]>;
  calibrationDevices?: NonAttribute<ModelInstance<"CalibrationDevice">[]>;

  softDelete(): Promise<Tenant>;
}

interface TenantStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineTenant = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Tenant, TenantStatics>;

/** Define the Tenant model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTenant = (db, DataTypes) => {
  const Tenant = initModel<Tenant, TenantStatics>(
    class extends Model {},
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
        type: DataTypes.ENUM(...TENANT_PLANS),
        defaultValue: "free",
      },
      status: {
        type: DataTypes.ENUM(...TENANT_STATUSES),
        defaultValue: "active",
      },
      trialEndsAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      billingCycle: {
        type: DataTypes.ENUM(...TENANT_BILLING_CYCLES),
        defaultValue: "monthly",
      },
      billingEmail: { type: DataTypes.STRING(255), allowNull: true },
      contactName: { type: DataTypes.STRING(255), allowNull: true },
      contactEmail: { type: DataTypes.STRING(255), allowNull: true },
      contactPhone: { type: DataTypes.STRING(50), allowNull: true },
      // ---- Profile (A-303; migration 0100 adds the columns to an existing table) ----
      // tenant.service#updateTenant always wrote these, and the edit form sent
      // them, but they were attributes of no model, so Sequelize dropped every one.
      description: { type: DataTypes.TEXT, allowNull: true },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      address: { type: DataTypes.TEXT, allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      state: { type: DataTypes.STRING(100), allowNull: true },
      zipCode: { type: DataTypes.STRING(20), allowNull: true },
      country: { type: DataTypes.STRING(100), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      settings: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("Tenant.settings") },
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
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Tenant",
      sequelize: db,
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
  const excludePlatformTenant = (options: PlatformExclusionOptions): void => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain -- as built: a defensive check; Sequelize always passes options
    if (options && options.includePlatformTenant === true) {
      return;
    }
    const notPlatform = { id: { [Op.ne]: PLATFORM_TENANT_ID } };
    options.where =
      options.where === undefined || options.where === null
        ? notPlatform
        : { [Op.and]: [options.where, notPlatform] };
  };
  Tenant.addHook("beforeFind", "excludePlatformTenant", excludePlatformTenant);
  Tenant.addHook("beforeCount", "excludePlatformTenant", excludePlatformTenant);
  Tenant.addHook(
    "beforeBulkUpdate",
    "excludePlatformTenant",
    excludePlatformTenant,
  );
  Tenant.addHook(
    "beforeBulkDestroy",
    "excludePlatformTenant",
    excludePlatformTenant,
  );

  /**
   * Soft-delete a tenant. Sets is_deleted = true and persists.
   */
  Tenant.prototype.softDelete = async function (this: Tenant): Promise<Tenant> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted tenant by ID. Sets is_deleted = false.
   */
  Tenant.restoreStatic = async function (
    this: TypedModel<Tenant, TenantStatics>,
    id: string,
  ): Promise<[affectedCount: number]> {
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
   * @param models - The aggregated models object
   */
  Tenant.associate = (models: Models): void => {
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

export = defineModel;
