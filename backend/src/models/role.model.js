/**
 * Role Model
 *
 * RBAC roles with CRUD permissions (read/write) on menu groups.
 * All roles are global (not tenant-scoped) for consistent permission management.
 */

/**
 * Define the Role model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Role = db.define(
    "Role",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      nameToShow: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      description: { type: DataTypes.TEXT, allowNull: true },
      isSystem: { type: DataTypes.BOOLEAN, defaultValue: false },
      status: { type: DataTypes.STRING(20), defaultValue: "active" },
      sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
      roleLevel: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "roles",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ["status"] }, { fields: ["is_deleted"] }],
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
   * Soft-delete a non-system role. Sets is_deleted = true and persists.
   * Throws if the role is a system role (is_system: true).
   */
  Role.prototype.softDelete = async function () {
    if (this.is_system) {
      const err = new Error("Cannot soft-delete system roles");
      err.code = "CANNOT_DELETE_SYSTEM_ROLE";
      throw err;
    }
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted role by ID. Sets is_deleted = false.
   */
  Role.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Role.associate = (models) => {
    // Role -> User (hasMany)
    Role.hasMany(models.User, { foreignKey: "roleId", as: "users" });
    // Role -> RoleMenuPermission (hasMany)
    Role.hasMany(models.RoleMenuPermission, {
      foreignKey: "roleId",
      as: "permissions",
      onDelete: "CASCADE",
    });
  };

  return Role;
};

module.exports = defineModel;
