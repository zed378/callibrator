/**
 * Warehouse Model
 *
 * Physical warehouse locations for a tenant.
 */

/**
 * Define the Warehouse model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Warehouse = db.define(
    "Warehouse",
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
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      address: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        defaultValue: "active",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "warehouses",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["code"] },
        { fields: ["status"] },
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
   * Soft-delete a warehouse. Sets is_deleted = true and persists.
   */
  Warehouse.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted warehouse by ID. Sets is_deleted = false.
   */
  Warehouse.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Warehouse.associate = (models) => {
    // Warehouse -> StorageLocation (hasMany)
    Warehouse.hasMany(models.StorageLocation, {
      foreignKey: "warehouse_id",
      as: "locations",
    });
    // Warehouse -> Stock (hasMany)
    Warehouse.hasMany(models.Stock, {
      foreignKey: "warehouse_id",
      as: "stocks",
    });
    // Warehouse -> StockTransfer (fromWarehouse)
    Warehouse.hasMany(models.StockTransfer, {
      foreignKey: "from_warehouse_id",
      as: "outgoingTransfers",
    });
    // Warehouse -> StockTransfer (toWarehouse)
    Warehouse.hasMany(models.StockTransfer, {
      foreignKey: "to_warehouse_id",
      as: "incomingTransfers",
    });
    // Warehouse -> StockAdjustment (hasMany)
    Warehouse.hasMany(models.StockAdjustment, {
      foreignKey: "warehouse_id",
      as: "adjustments",
    });
    // Warehouse -> StockOpname (hasMany)
    Warehouse.hasMany(models.StockOpname, {
      foreignKey: "warehouse_id",
      as: "opnames",
    });
  };

  return Warehouse;
};

module.exports = defineModel;
