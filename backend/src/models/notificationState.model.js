const { Model, DataTypes } = require("sequelize");

/**
 * Per-user notification state.
 *
 * A notification row is shared when it is tenant-wide (`notifications.user_id`
 * IS NULL): every user in the tenant sees the same row. Storing `is_read` on
 * that row means one user marking it read — or deleting it — changes it for
 * everyone. This table moves the per-recipient bits (read + hidden) out of the
 * shared row, keyed by (notification, user).
 *
 * Rows here are created lazily: no state row means "unread and visible", so a
 * broadcast to 5,000 users costs 1 notification row, not 5,000.
 */
module.exports = (sequelize) => {
  class NotificationState extends Model {
    static associate(models) {
      NotificationState.belongsTo(models.Notification, {
        foreignKey: "notificationId",
        as: "notification",
        onDelete: "CASCADE",
      });
      NotificationState.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        onDelete: "CASCADE",
      });
    }
  }

  NotificationState.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      notificationId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "notifications", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Per-user hide. The shared notification row survives for everyone else.
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "NotificationState",
      tableName: "notification_states",
      timestamps: true,
      underscored: true,
      // NOT paranoid: `deletedAt` here means "hidden for this user", it is not
      // a soft-delete of the state row itself.
      indexes: [
        { unique: true, fields: ["notification_id", "user_id"] },
        { fields: ["user_id"] },
      ],
    },
  );

  return NotificationState;
};
