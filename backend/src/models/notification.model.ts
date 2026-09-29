// P9-10 (ADR-087 Amendments 7–8): converted from notification.model.js with no behaviour
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
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const NOTIFICATION_TYPES = [
  "SYSTEM",
  "CALIBRATION",
  "INVENTORY",
  "MAINTENANCE",
] as const;

/** A Notification row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Notification extends Model<
  InferAttributes<Notification>,
  InferCreationAttributes<Notification>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  /** null = tenant-wide (every user sees the one row; per-user bits live in NotificationState). */
  userId: UserId | null;
  type: CreationOptional<(typeof NOTIFICATION_TYPES)[number]>;
  title: string;
  message: string;
  isRead: CreationOptional<boolean>;
  actionUrl: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  user?: NonAttribute<ModelInstance<"User">>;
  states?: NonAttribute<ModelInstance<"NotificationState">[]>;
}

interface NotificationStatics {
  associate(models: Models): void;
}

type DefineNotification = (
  sequelize: Sequelize,
) => TypedModel<Notification, NotificationStatics>;

/** Define the Notification model (a fresh class per call). */
const defineModel: DefineNotification = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class NotificationModel extends Model {
    static associate(models: Models): void {
      Notification.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      Notification.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        onDelete: "CASCADE",
      });
      // Per-recipient read/hidden flags (see notificationState.model.js).
      Notification.hasMany(models.NotificationState, {
        foreignKey: "notificationId",
        as: "states",
        onDelete: "CASCADE",
      });
    }
  }

  const Notification = initModel<Notification, NotificationStatics>(
    NotificationModel,
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "tenants",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      type: {
        type: DataTypes.ENUM(...NOTIFICATION_TYPES),
        allowNull: false,
        defaultValue: "SYSTEM",
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      actionUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Notification",
      tableName: "notifications",
      timestamps: true,
      underscored: true,
    },
  );

  return Notification;
};

export = defineModel;
