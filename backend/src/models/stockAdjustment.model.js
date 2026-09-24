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
        onDelete: "RESTRICT",
      },
      warehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "RESTRICT",
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
      // P6-09: required, and never blank — CHECK (btrim(reason) <> '') from
      // migration 0059. Rows older than P6-09 carry a reason saying none was
      // recorded.
      reason: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // P6-09: WHICH item moved, and from what to what. Nullable only because
      // rows written before migration 0059 cannot be attributed after the
      // fact; stock.service writes all three on every adjustment.
      stockId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "stocks", key: "id" },
        onDelete: "RESTRICT",
      },
      quantityBefore: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      quantityAfter: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      adjustedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
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
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // StockAdjustment -> Warehouse
    StockAdjustment.belongsTo(models.Warehouse, {
      foreignKey: "warehouseId",
      as: "warehouse",
      onDelete: "RESTRICT",
    });
    // StockAdjustment -> StorageLocation
    StockAdjustment.belongsTo(models.StorageLocation, {
      foreignKey: "locationId",
      as: "location",
      onDelete: "SET NULL",
    });
    // StockAdjustment -> Stock (the item adjusted; P6-09)
    StockAdjustment.belongsTo(models.Stock, {
      foreignKey: "stockId",
      as: "stock",
      onDelete: "RESTRICT",
    });
    // StockAdjustment -> User (adjustedBy)
    StockAdjustment.belongsTo(models.User, {
      foreignKey: "adjustedBy",
      as: "adjuster",
      onDelete: "RESTRICT",
    });
  };

  return StockAdjustment;
};

module.exports = defineModel;
