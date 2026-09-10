/**
 * Session Model
 *
 * Persistent authentication session records stored in PostgreSQL.
 * Used for session management, logout, and audit purposes.
 */

/**
 * Define the Session model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Session = db.define(
    "Session",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      device: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      expired_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_activity_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_revoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revoked_reason: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "sessions",
      timestamps: true,
      underscored: true,
      underscoredAll: true,
      indexes: [
        { fields: ["token_hash"], unique: true },
        { fields: ["user_id"] },
        { fields: ["tenant_id"] },
        { fields: ["expired_at"] },
        { fields: ["is_revoked", "is_active"] },
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
   * Soft-delete a session. Sets is_deleted = true, records deleted_at timestamp,
   * and persists. Also revokes the session (sets is_revoked = true).
   */
  Session.prototype.softDelete = async function () {
    this.is_deleted = true;
    this.deleted_at = new Date();
    this.is_revoked = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted session by ID. Sets is_deleted = false and nulls deleted_at.
   */
  Session.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false, deleted_at: null },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Session.associate = (models) => {
    // Session -> User
    Session.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    // Session -> Tenant
    Session.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  return Session;
};

module.exports = defineModel;
