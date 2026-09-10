/**
 * StockTransfer Model
 *
 * Tracks inter-warehouse stock transfers.
 */

/**
 * Define the StockTransfer model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const StockTransfer = db.define(
    "StockTransfer",
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
      fromWarehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "CASCADE",
      },
      toWarehouseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "warehouses", key: "id" },
        onDelete: "CASCADE",
      },
      status: {
        type: DataTypes.ENUM("pending", "in_transit", "completed", "cancelled"),
        defaultValue: "pending",
      },
      requestedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      approvedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      itemName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      transferDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "stock_transfers",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["from_warehouse_id"] },
        { fields: ["to_warehouse_id"] },
        { fields: ["status"] },
      ],
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  StockTransfer.associate = (models) => {
    // StockTransfer -> Tenant
    StockTransfer.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    // StockTransfer -> Warehouse (from)
    StockTransfer.belongsTo(models.Warehouse, {
      foreignKey: "from_warehouse_id",
      as: "fromWarehouse",
    });
    // StockTransfer -> Warehouse (to)
    StockTransfer.belongsTo(models.Warehouse, {
      foreignKey: "to_warehouse_id",
      as: "toWarehouse",
    });
    // StockTransfer -> User (requestedBy)
    StockTransfer.belongsTo(models.User, {
      foreignKey: "requested_by",
      as: "requester",
    });
    // StockTransfer -> User (approvedBy)
    StockTransfer.belongsTo(models.User, {
      foreignKey: "approved_by",
      as: "approver",
    });
  };

  return StockTransfer;
};

module.exports = defineModel;
