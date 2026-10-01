/**
 * Webhook Model
 *
 * Tenant-scoped outbound webhook subscriptions. Each webhook subscribes to a set
 * of domain events and receives HMAC-signed POST deliveries when they occur.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from webhook.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
  type SaveOptions,
} from "sequelize";
import { jsonShape, type WebhookEvents } from "../utils/jsonShape.util";
import type { TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** A Webhook row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Webhook extends Model<
  InferAttributes<Webhook>,
  InferCreationAttributes<Webhook>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  url: string;
  /** JSONB, D-27 shape `Webhook.events`. */
  events: CreationOptional<WebhookEvents>;
  /** A kms.service envelope (`v1:...`), never plaintext (A-51). No default: only webhook.service writes it. */
  secret: string;
  /** P6-13: the envelope a rotation replaced; never returned by the API. */
  previousSecret: string | null;
  previousSecretExpiresAt: Date | null;
  description: string | null;
  isActive: CreationOptional<boolean>;
  createdBy: UserId | null;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  deliveries?: NonAttribute<ModelInstance<"WebhookDelivery">[]>;

  /** P6-13: takes the caller's options, so the delete and its audit row share one transaction. */
  softDelete(options?: SaveOptions<InferAttributes<Webhook>>): Promise<Webhook>;
}

interface WebhookStatics {
  associate: (models: Models) => void;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineWebhook = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Webhook, WebhookStatics>;

/** Define the Webhook model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineWebhook = (db, DataTypes) => {
  const Webhook = initModel<Webhook, WebhookStatics>(
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
      url: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        validate: {
          // Accept any http(s) URL (incl. localhost in dev). NOTE: outbound
          // webhook URLs are attacker-influenced — SSRF hardening (blocking
          // internal/link-local targets) is a recommended follow-on.
          isHttpUrl(value: unknown): void {
            // String(value): RegExp#test converts its argument with ToString, so this is the same test.
            if (!/^https?:\/\/.+/i.test(String(value))) {
              throw new Error("url must be a valid http(s) URL");
            }
          },
        },
      },
      // Subscribed event names, e.g. ["certificate.signed","device.overdue"].
      // The special value "*" subscribes to every event.
      events: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("Webhook.events") },
        allowNull: false,
        defaultValue: [],
      },
      // Shared secret used to HMAC-sign delivery payloads — stored as a
      // kms.service envelope (`v1:...`, tenant id as AAD), never plaintext
      // (A-51). TEXT because the envelope is ~200 characters; migration 0022
      // widened the column and encrypted the rows that predate it.
      //
      // No defaultValue, on purpose: the old default generated a PLAINTEXT
      // secret the caller never saw. The only writer is webhook.service.js,
      // which generates, seals and returns it once; a create that bypasses the
      // service now fails allowNull rather than storing an unencrypted key.
      secret: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // P6-13 (ADR-085, migration 0090): the secret a rotation replaced, as the
      // same kms.service envelope, and when it stops signing. While
      // previousSecretExpiresAt is in the future a delivery carries a second
      // signature under it (X-Webhook-Signature-Previous), so a receiver can
      // switch secrets without a coordinated cut-over. Never returned by the API.
      previousSecret: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      previousSecretExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "webhooks",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["is_deleted"] }],
      // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
      defaultScope: { where: { is_deleted: false } },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Webhook",
      sequelize: db,
    },
  );

  // P6-13: takes the caller's options, so the delete and its audit row share
  // one transaction.
  Webhook.prototype.softDelete = async function (
    this: Webhook,
    options: SaveOptions<InferAttributes<Webhook>> = {},
  ): Promise<Webhook> {
    this.isDeleted = true;
    return this.save({ ...options, hooks: false });
  };

  Webhook.associate = (models: Models): void => {
    Webhook.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
    Webhook.hasMany(models.WebhookDelivery, {
      foreignKey: "webhookId",
      as: "deliveries",
      onDelete: "CASCADE",
    });
  };

  return Webhook;
};

export = defineModel;
