/**
 * MenuGroup Model
 *
 * Top-level navigation menu groups.
 * Used for RBAC menu-based access control via RoleMenuPermission.
 */

/**
 * Define the MenuGroup model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const MenuGroup = db.define(
    "MenuGroup",
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
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      icon: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      parentId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "menu_groups", key: "id" },
        onDelete: "SET NULL",
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "menu_groups",
      timestamps: true,
      paranoid: false,
      underscored: true,
      indexes: [
        { fields: ["slug"] },
        { fields: ["is_active"] },
        { fields: ["parent_id"] },
      ],
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  MenuGroup.associate = (models) => {
    // Self-referencing parent menu group
    MenuGroup.belongsTo(MenuGroup, {
      foreignKey: "parent_id",
      as: "parent",
      onDelete: "SET NULL",
    });
    // Children
    MenuGroup.hasMany(MenuGroup, {
      foreignKey: "parent_id",
      as: "children",
      onDelete: "SET NULL",
    });
    // MenuGroup -> RoleMenuPermission (hasMany)
    MenuGroup.hasMany(models.RoleMenuPermission, {
      foreignKey: "menu_group_id",
      as: "rolePermissions",
      onDelete: "CASCADE",
    });
  };

  return MenuGroup;
};

module.exports = defineModel;
