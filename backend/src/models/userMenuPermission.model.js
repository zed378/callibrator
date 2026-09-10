/**
 * UserMenuPermission Model
 *
 * Per-user permission overrides on menu groups. A user normally inherits
 * permissions from their role (role_menu_permissions); rows in this table
 * override that inheritance for a single user:
 *
 *   - permissionType "read"  → user gets read on this menu (regardless of role)
 *   - permissionType "write" → user gets write on this menu (regardless of role)
 *   - permissionType "none"  → user is explicitly DENIED this menu even if
 *                              their role grants it
 *
 * Removing the row restores plain role inheritance.
 */

/**
 * Define the UserMenuPermission model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const UserMenuPermission = db.define(
    "UserMenuPermission",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
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
          isIn: [["read", "write", "none"]],
        },
      },
      grantedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      notes: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "user_menu_permissions",
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["user_id", "menu_group_id"],
          unique: true,
        },
        { fields: ["user_id"] },
        { fields: ["menu_group_id"] },
      ],
      paranoid: false,
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  UserMenuPermission.associate = (models) => {
    UserMenuPermission.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    UserMenuPermission.belongsTo(models.MenuGroup, {
      foreignKey: "menu_group_id",
      as: "menu",
      onDelete: "CASCADE",
    });
    UserMenuPermission.belongsTo(models.User, {
      foreignKey: "granted_by",
      as: "grantor",
    });
  };

  return UserMenuPermission;
};

module.exports = defineModel;
