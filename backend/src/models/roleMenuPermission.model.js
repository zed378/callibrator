/**
 * RoleMenuPermission Model
 *
 * Maps permissions (read/write) on menu groups to roles.
 * Each record defines whether a role has read or write access
 * to a specific menu group.
 */

/**
 * Define the RoleMenuPermission model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const RoleMenuPermission = db.define(
    "RoleMenuPermission",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "roles", key: "id" },
        onDelete: "CASCADE",
      },
      menuGroupId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "menu_groups", key: "id" },
        onDelete: "CASCADE",
      },
      permissionType: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "read",
        validate: {
          isIn: [["read", "write"]],
        },
      },
    },
    {
      tableName: "role_menu_permissions",
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["role_id", "menu_group_id"],
          unique: true,
        },
        { fields: ["role_id"] },
        { fields: ["menu_group_id"] },
      ],
      paranoid: false,
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  RoleMenuPermission.associate = (models) => {
    // RoleMenuPermission -> Role
    RoleMenuPermission.belongsTo(models.Role, {
      foreignKey: "role_id",
      as: "role",
      onDelete: "CASCADE",
    });
    // RoleMenuPermission -> MenuGroup
    RoleMenuPermission.belongsTo(models.MenuGroup, {
      foreignKey: "menu_group_id",
      as: "menu",
      onDelete: "CASCADE",
    });
  };

  return RoleMenuPermission;
};

module.exports = defineModel;
