/**
 * User Model
 *
 * Individual user accounts within tenants.
 * Users have roles for RBAC and belong to tenants.
 */

const {
  DEFAULT_UPLOAD_PLACEHOLDER,
} = require("../constants/appConstants");

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
        onDelete: "RESTRICT",
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
      // A-114: a secret being enrolled or rotated in. It is NOT the live
      // second factor — nothing signs in with it — until verifyMfaSetup
      // accepts a code from it and promotes it to mfaSecret. Held with the
      // time it was issued; an enrolment older than MFA_PENDING_TTL_MS is
      // refused (auth.service.js). Column added by migration 0028.
      mfaPendingSecret: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      mfaPendingCreatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // A-115: the last TOTP time step (floor(epoch / 30)) this account had a
      // code accepted for. A code whose step is <= this is a replay and is
      // refused (mfa.service.js#consumeCode). INTEGER holds steps until the
      // year ~4010. Column added by migration 0028.
      mfaLastUsedStep: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // A-141: SHA-256 hashes (salted with the user id) of the one-time
      // recovery codes issued at MFA enable / rotate. A code is consumed by a
      // conditional update that removes its hash (mfa.service.js
      // #consumeRecoveryCode). Never returned by any endpoint. Migration 0031.
      mfaRecoveryCodes: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: true,
      },
      // A-123 (ADR-051 Q-11): set on an account an administrator created, so
      // the admin-chosen password is changed at first sign-in. While set,
      // auth.middleware refuses every route but change-password, logout and
      // "who am I". Migration 0031.
      mustChangePassword: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
          // DEFAULT_UPLOAD_PLACEHOLDER means "no avatar uploaded". Building a
          // URL from it yields /uploads/public/profile/default.svg, which 404s —
          // nothing ships that file, and /app/uploads is a volume that would
          // shadow it anyway. Returning null lets the UI render its initials
          // block, which is the intended appearance for a user with no photo.
          if (!avatar || avatar === DEFAULT_UPLOAD_PLACEHOLDER) {
            return null;
          }
          return `${baseUrl}/uploads/public/profile/${avatar}`;
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
    // `isDeleted` is the ATTRIBUTE (column is_deleted via underscored).
    // Model.update intersects its values with attribute names, so the former
    // `{ is_deleted: false }` was dropped and nothing was written (D-07).
    // unscoped(): the defaultScope pins isDeleted = false, which a restore
    // must not inherit; paranoid and the global tenant hooks still apply.
    return this.unscoped().update(
      { isDeleted: false },
      { where: { id, isDeleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  User.associate = (models) => {
    // User -> Role
    User.belongsTo(models.Role, {
      foreignKey: "roleId",
      as: "role",
      onDelete: "SET NULL",
    });
    // User -> Tenant
    User.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // User -> Session (hasMany)
    User.hasMany(models.Session, {
      foreignKey: "user_id",
      as: "sessions",
    });
    // User -> StockTransfer (requestedBy)
    User.hasMany(models.StockTransfer, {
      foreignKey: "requestedBy",
      as: "requestedTransfers",
      onDelete: "RESTRICT",
    });
    // User -> StockTransfer (approvedBy)
    User.hasMany(models.StockTransfer, {
      foreignKey: "approvedBy",
      as: "approvedTransfers",
      onDelete: "SET NULL",
    });
    // User -> StockAdjustment (adjustedBy)
    User.hasMany(models.StockAdjustment, {
      foreignKey: "adjustedBy",
      as: "adjustments",
      onDelete: "RESTRICT",
    });
    // User -> StockOpname (performedBy)
    User.hasMany(models.StockOpname, {
      foreignKey: "performedBy",
      as: "performedOpnames",
      onDelete: "RESTRICT",
    });
    // User -> CalibrationRecord (performedBy)
    // The ATTRIBUTE, not the column: "performed_by" added a second, nullable
    // attribute that sync() built as nullable + SET NULL (A-88 shape; F-6).
    User.hasMany(models.CalibrationRecord, {
      foreignKey: "performedBy",
      as: "calibrationRecords",
      onDelete: "RESTRICT",
    });
  };

  return User;
};

module.exports = defineModel;
