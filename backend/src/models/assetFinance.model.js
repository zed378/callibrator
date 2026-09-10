/**
 * AssetFinance Model
 *
 * Financial record for a calibration device (asset): purchase cost, useful
 * life, salvage value, and depreciation method. Drives the depreciation
 * report (capital expenditure / book value for CFO-level reporting).
 *
 * One financial record per device (unique device_id).
 */

/**
 * Define the AssetFinance model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const AssetFinance = db.define(
    "AssetFinance",
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
      },
      usefulLifeYears: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 50 },
      },
      depreciationMethod: {
        type: DataTypes.ENUM("straight_line", "declining_balance"),
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
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  AssetFinance.associate = (models) => {
    AssetFinance.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
      onDelete: "CASCADE",
    });
    AssetFinance.belongsTo(models.CalibrationDevice, {
      foreignKey: "device_id",
      as: "device",
      onDelete: "CASCADE",
    });
    AssetFinance.belongsTo(models.Vendor, {
      foreignKey: "vendor_id",
      as: "vendor",
    });
  };

  return AssetFinance;
};

module.exports = defineModel;
