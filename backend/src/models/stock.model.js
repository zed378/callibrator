/**
 * Stock Model
 *
 * Tracks inventory levels per item per warehouse location.
 */

/**
 * Define the Stock model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Stock = db.define(
    "Stock",
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
      itemName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      sku: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      minQuantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "stocks",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["warehouse_id"] },
        { fields: ["location_id"] },
        { fields: ["sku"] },
        { fields: ["serial_number"] },
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
   * Soft-delete a stock record. Sets is_deleted = true and persists.
   */
  Stock.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted stock record by ID. Sets is_deleted = false.
   */
  Stock.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Stock.associate = (models) => {
    // Stock -> Tenant
    Stock.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    // Stock -> Warehouse
    Stock.belongsTo(models.Warehouse, {
      foreignKey: "warehouse_id",
      as: "warehouse",
    });
    // Stock -> StorageLocation
    Stock.belongsTo(models.StorageLocation, {
      foreignKey: "location_id",
      as: "location",
    });
  };

  return Stock;
};

module.exports = defineModel;
