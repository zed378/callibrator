/**
 * User Model
 *
 * Individual user accounts within tenants.
 * Users have roles for RBAC and belong to tenants.
 */

/**
 * Define the User model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const User = db.define(
    "User",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "roles", key: "id" },
        onDelete: "SET NULL",
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
      },
      password: { type: DataTypes.STRING(255), allowNull: false },
      firstName: { type: DataTypes.STRING(100), allowNull: false },
      lastName: { type: DataTypes.STRING(100), allowNull: false },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      avatarUrl: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        defaultValue: "default.svg",
      },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "ACTIVE",
      },
      isEmailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      // Authentication security fields
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Multi-Factor Authentication (TOTP)
      mfaEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      mfaSecret: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // WebAuthn (passkeys / security keys)
      webauthnEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      webauthnCredentialId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      webauthnPublicKey: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Authenticator signature counter, used to detect cloned credentials.
      webauthnSignCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      // OTP fields
      otpCode: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      otpExpiredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      otpRequestCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      otpLastRequestedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      passwordChangedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "users",
      timestamps: true,
      paranoid: true,
      underscored: true,
      getterMethods: {
        picture() {
          const avatar = this.getDataValue("avatarUrl");
          const baseUrl = process.env.HOST_URL || "";
          return avatar ? `${baseUrl}/uploads/profile/${avatar}` : null;
        },
        first_name() {
          return this.getDataValue("firstName");
        },
        last_name() {
          return this.getDataValue("lastName");
        },
      },
      indexes: [
        { fields: ["username"], unique: true },
        { fields: ["email"], unique: true },
        { fields: ["tenant_id", "email"] },
        { fields: ["tenant_id", "role_id"] },
        { fields: ["status"] },
        { fields: ["is_active"] },
        { fields: ["failed_login_attempts"] },
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
   * Soft-delete a user. Sets is_deleted = true and persists.
   */
  User.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted user by ID. Sets is_deleted = false.
   */
  User.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  User.associate = (models) => {
    // User -> Role
    User.belongsTo(models.Role, {
      foreignKey: "role_id",
      as: "role",
      onDelete: "SET NULL",
    });
    // User -> Tenant
    User.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    // User -> Session (hasMany)
    User.hasMany(models.Session, {
      foreignKey: "user_id",
      as: "sessions",
    });
    // User -> StockTransfer (requestedBy)
    User.hasMany(models.StockTransfer, {
      foreignKey: "requested_by",
      as: "requestedTransfers",
    });
    // User -> StockTransfer (approvedBy)
    User.hasMany(models.StockTransfer, {
      foreignKey: "approved_by",
      as: "approvedTransfers",
    });
    // User -> StockAdjustment (adjustedBy)
    User.hasMany(models.StockAdjustment, {
      foreignKey: "adjusted_by",
      as: "adjustments",
    });
    // User -> StockOpname (performedBy)
    User.hasMany(models.StockOpname, {
      foreignKey: "performed_by",
      as: "performedOpnames",
    });
    // User -> CalibrationRecord (performedBy)
    User.hasMany(models.CalibrationRecord, {
      foreignKey: "performed_by",
      as: "calibrationRecords",
    });
  };

  return User;
};

module.exports = defineModel;
