/**
 * StockAdjustment Model
 *
 * Tracks manual stock adjustments (addition/subtraction/write_off).
 */

/**
 * Define the StockAdjustment model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const StockAdjustment = db.define(
    "StockAdjustment",
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
      warehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "CASCADE",
      },
      locationId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "storage_locations", key: "id" },
        onDelete: "SET NULL",
      },
      type: {
        type: DataTypes.ENUM("addition", "subtraction", "write_off"),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      adjustedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "stock_adjustments",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["warehouse_id"] },
        { fields: ["type"] },
      ],
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  StockAdjustment.associate = (models) => {
    // StockAdjustment -> Tenant
    StockAdjustment.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    // StockAdjustment -> Warehouse
    StockAdjustment.belongsTo(models.Warehouse, {
      foreignKey: "warehouse_id",
      as: "warehouse",
    });
    // StockAdjustment -> StorageLocation
    StockAdjustment.belongsTo(models.StorageLocation, {
      foreignKey: "location_id",
      as: "location",
    });
    // StockAdjustment -> User (adjustedBy)
    StockAdjustment.belongsTo(models.User, {
      foreignKey: "adjusted_by",
      as: "adjuster",
    });
  };

  return StockAdjustment;
};

module.exports = defineModel;
