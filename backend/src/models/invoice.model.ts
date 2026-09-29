// P9-10 (ADR-087 Amendments 7–8): converted from invoice.model.js with no behaviour
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
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/**
 * D-21: a NUMERIC read back from pg (a string) as a number; null AND undefined
 * are returned as they are (the spec's warning: `value ?? null` would turn
 * undefined into null). Typed `unknown` in and out: the value getDataValue
 * holds is the driver's string, whatever the attribute's declared (getter) type.
 */
const toNumber = (value: unknown): unknown =>
  value === null || value === undefined ? value : Number(value);

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const INVOICE_STATUSES = [
  "Draft",
  "Open",
  "Paid",
  "Uncollectible",
  "Void",
] as const;

/** A Invoice row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Invoice extends Model<
  InferAttributes<Invoice>,
  InferCreationAttributes<Invoice>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  subscriptionId: string;
  /** DECIMAL(10,2), read as a number by its getter (D-21). `raw: true` / SUM() still return a string. */
  amountDue: CreationOptional<number>;
  /** DECIMAL(10,2), read as a number by its getter (D-21). */
  amountPaid: CreationOptional<number>;
  currency: CreationOptional<string>;
  status: CreationOptional<(typeof INVOICE_STATUSES)[number]>;
  invoiceUrl: string | null;
  stripeInvoiceId: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  subscription?: NonAttribute<ModelInstance<"Subscription">>;
}

interface InvoiceStatics {
  associate(models: Models): void;
}

type DefineInvoice = (
  sequelize: Sequelize,
) => TypedModel<Invoice, InvoiceStatics>;

/** Define the Invoice model (a fresh class per call). */
const defineModel: DefineInvoice = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class InvoiceModel extends Model {
    static associate(models: Models): void {
      Invoice.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      Invoice.belongsTo(models.Subscription, {
        foreignKey: "subscriptionId",
        as: "subscription",
        onDelete: "CASCADE",
      });
    }
  }

  const Invoice = initModel<Invoice, InvoiceStatics>(
    InvoiceModel,
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
        onDelete: "RESTRICT",
      },
      subscriptionId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "subscriptions",
          key: "id",
        },
      },
      amountDue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"), so
        // `a + b` concatenated and `>` compared lexicographically. Read as a
        // number; NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get(this: Invoice): unknown {
          return toNumber(this.getDataValue("amountDue"));
        },
      },
      amountPaid: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
        // D-21: node-postgres returns NUMERIC as a string ("1250.00"), so
        // `a + b` concatenated and `>` compared lexicographically. Read as a
        // number; NULL stays NULL. `raw: true` queries and SUM() bypass this.
        get(this: Invoice): unknown {
          return toNumber(this.getDataValue("amountPaid"));
        },
      },
      currency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "USD",
      },
      status: {
        type: DataTypes.ENUM(...INVOICE_STATUSES),
        allowNull: false,
        defaultValue: "Draft",
      },
      invoiceUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Stripe invoice id — used to de-duplicate webhook deliveries (Stripe
      // retries). Nullable for invoices not originating from Stripe.
      stripeInvoiceId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
    },
    {
      sequelize,
      modelName: "Invoice",
      tableName: "invoices",
      timestamps: true,
      underscored: true,
    },
  );

  return Invoice;
};

export = defineModel;
