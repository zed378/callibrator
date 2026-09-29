/**
 * AssetFinance Model
 *
 * Financial record for a calibration device (asset): purchase cost, useful
 * life, salvage value, and depreciation method. Drives the depreciation
 * report (capital expenditure / book value for CFO-level reporting).
 *
 * One financial record per device (unique device_id).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from assetFinance.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/**
 * D-21: a NUMERIC read back from pg (a string) as a number; null AND undefined
 * are returned as they are (the spec's warning: `value ?? null` would turn
 * undefined into null). Typed `unknown` in and out: the value getDataValue
 * holds is the driver's string, whatever the attribute's declared (getter) type.
 */
const toNumber = (value: unknown): unknown =>
  value === null || value === undefined ? value : Number(value);

/** The `depreciationMethod` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const DEPRECIATION_METHODS = ["straight_line", "declining_balance"] as const;

/** A AssetFinance row (attributes, included associations, instance methods). Types only: emits nothing. */
interface AssetFinance extends Model<
  InferAttributes<AssetFinance>,
  InferCreationAttributes<AssetFinance>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  deviceId: string;
  /** DECIMAL(14,2), read as a number by its getter (D-21). `raw: true` / SUM() still return a string. */
  purchasePrice: number;
  /** DATEONLY: a "YYYY-MM-DD" string from pg. */
  purchaseDate: string;
  /** DECIMAL(14,2), read as a number by its getter (D-21). */
  salvageValue: CreationOptional<number>;
  usefulLifeYears: number;
  depreciationMethod: CreationOptional<(typeof DEPRECIATION_METHODS)[number]>;
  vendorId: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  device?: NonAttribute<ModelInstance<"CalibrationDevice">>;
  vendor?: NonAttribute<ModelInstance<"Vendor">>;
}

interface AssetFinanceStatics {
  associate: (models: Models) => void;
}

type DefineAssetFinance = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<AssetFinance, AssetFinanceStatics>;

/** Define the AssetFinance model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineAssetFinance = (db, DataTypes) => {
  const AssetFinance = initModel<AssetFinance, AssetFinanceStatics>(
    class extends Model {},
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
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "calibration_devices", key: "id" },
        onDelete: "CASCADE",
      },
      purchasePrice: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        validate: { min: 0 },
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"), so
        // `a + b` concatenated and `>` compared lexicographically. Read as a
        // number; NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get(this: AssetFinance): unknown {
          return toNumber(this.getDataValue("purchasePrice"));
        },
      },
      purchaseDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      salvageValue: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"), so
        // `a + b` concatenated and `>` compared lexicographically. Read as a
        // number; NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get(this: AssetFinance): unknown {
          return toNumber(this.getDataValue("salvageValue"));
        },
      },
      usefulLifeYears: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 50 },
      },
      depreciationMethod: {
        type: DataTypes.ENUM(...DEPRECIATION_METHODS),
        allowNull: false,
        defaultValue: "straight_line",
      },
      vendorId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "vendors", key: "id" },
        onDelete: "SET NULL",
      },
      invoiceNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "asset_finances",
      timestamps: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["device_id"], unique: true },
        { fields: ["tenant_id"] },
        { fields: ["purchase_date"] },
      ],
      modelName: "AssetFinance",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  AssetFinance.associate = (models: Models): void => {
    AssetFinance.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    AssetFinance.belongsTo(models.CalibrationDevice, {
      foreignKey: "deviceId",
      as: "device",
      onDelete: "CASCADE",
    });
    AssetFinance.belongsTo(models.Vendor, {
      foreignKey: "vendorId",
      as: "vendor",
      onDelete: "SET NULL",
    });
  };

  return AssetFinance;
};

export = defineModel;
