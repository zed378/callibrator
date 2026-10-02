/**
 * WebhookDelivery Model
 *
 * Audit log of individual webhook delivery attempts (one row per webhook per
 * event). Tracks status, attempt count, and the last response/error.
 *
 * Since A-10 (ADR-054) this row is also the durable delivery queue (an
 * outbox): `status` pending|failed + `nextAttemptAt` is the retry schedule,
 * and `exhausted` is the dead letter. See services/webhook.service.ts.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from webhookDelivery.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import { jsonShape, type WebhookPayload } from "../utils/jsonShape.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";
import { WEBHOOK_DELIVERY_STATUSES } from "@callibrator/contracts/states";

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
// P9-05: the one list is WEBHOOK_DELIVERY_STATUSES in @callibrator/contracts/states.
const DELIVERY_STATUSES = WEBHOOK_DELIVERY_STATUSES;

/** A WebhookDelivery row (attributes, included associations, instance methods). Types only: emits nothing. */
interface WebhookDelivery extends Model<
  InferAttributes<WebhookDelivery>,
  InferCreationAttributes<WebhookDelivery>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  webhookId: string;
  event: string;
  /** JSONB, D-27 shape `WebhookDelivery.payload`. */
  payload: CreationOptional<WebhookPayload>;
  /** The outbox state (A-10): pending | failed + nextAttemptAt is the retry schedule; exhausted is the dead letter. */
  status: CreationOptional<(typeof DELIVERY_STATUSES)[number]>;
  attempts: CreationOptional<number>;
  responseStatus: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  nextAttemptAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  webhook?: NonAttribute<ModelInstance<"Webhook">>;
}

interface WebhookDeliveryStatics {
  associate: (models: Models) => void;
}

type DefineWebhookDelivery = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<WebhookDelivery, WebhookDeliveryStatics>;

/** Define the WebhookDelivery model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineWebhookDelivery = (db, DataTypes) => {
  const WebhookDelivery = initModel<WebhookDelivery, WebhookDeliveryStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      webhookId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "webhooks", key: "id" },
        onDelete: "CASCADE",
      },
      event: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("WebhookDelivery.payload") },
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM(...DELIVERY_STATUSES),
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      responseStatus: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      lastError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // A-10 / migration 0043: when the delivery is next due. The dispatcher
      // claims rows with status pending|failed and nextAttemptAt <= now(),
      // pushing it forward by a lease while an attempt is in flight. NULL on a
      // row that is finished (success / exhausted).
      nextAttemptAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "webhook_deliveries",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["webhook_id"] },
        { fields: ["status"] },
      ],
      modelName: "WebhookDelivery",
      sequelize: db,
    },
  );

  WebhookDelivery.associate = (models: Models): void => {
    WebhookDelivery.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
    WebhookDelivery.belongsTo(models.Webhook, {
      foreignKey: "webhookId",
      as: "webhook",
      onDelete: "CASCADE",
    });
  };

  return WebhookDelivery;
};

export = defineModel;
