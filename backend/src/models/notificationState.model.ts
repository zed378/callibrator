// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its Notification (scoped). Every query names notificationId.
// Held by tests/models/unscopedModels.d17.test.js.

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
// P9-10 (ADR-087 Amendments 7–8): converted from notificationState.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  DataTypes,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A NotificationState row (attributes, included associations, instance methods). Types only: emits nothing. */
interface NotificationState extends Model<
  InferAttributes<NotificationState>,
  InferCreationAttributes<NotificationState>
> {
  id: CreationOptional<string>;
  notificationId: string;
  userId: UserId;
  isRead: CreationOptional<boolean>;
  readAt: Date | null;
  /** "hidden for this user" — an ordinary column, NOT paranoid (declared in init, so passed to it). */
  deletedAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  notification?: NonAttribute<ModelInstance<"Notification">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface NotificationStateStatics {
  associate(models: Models): void;
}

type DefineNotificationState = (
  sequelize: Sequelize,
) => TypedModel<NotificationState, NotificationStateStatics>;

/** Define the NotificationState model (a fresh class per call). */
const defineModel: DefineNotificationState = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class NotificationStateModel extends Model {
    static associate(models: Models): void {
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

  const NotificationState = initModel<
    NotificationState,
    NotificationStateStatics,
    // deletedAt is this model's own column (per-user hide), passed to init as before
    "createdAt" | "updatedAt"
  >(
    NotificationStateModel,
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

export = defineModel;
