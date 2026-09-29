// P9-10 (ADR-087 Amendments 7–8): converted from subscription.model.js with no behaviour
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

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const SUBSCRIPTION_STATUSES = [
  "Active",
  "PastDue",
  "Canceled",
  "Unpaid",
] as const;

/** The `billingCycle` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const BILLING_CYCLES = ["Monthly", "Annually"] as const;

/** A Subscription row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Subscription extends Model<
  InferAttributes<Subscription>,
  InferCreationAttributes<Subscription>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  planId: CreationOptional<string>;
  status: CreationOptional<(typeof SUBSCRIPTION_STATUSES)[number]>;
  billingCycle: CreationOptional<(typeof BILLING_CYCLES)[number]>;
  currentPeriodStart: CreationOptional<Date>;
  currentPeriodEnd: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  invoices?: NonAttribute<ModelInstance<"Invoice">[]>;
}

interface SubscriptionStatics {
  associate(models: Models): void;
}

type DefineSubscription = (
  sequelize: Sequelize,
) => TypedModel<Subscription, SubscriptionStatics>;

/** Define the Subscription model (a fresh class per call). */
const defineModel: DefineSubscription = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class SubscriptionModel extends Model {
    static associate(models: Models): void {
      Subscription.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      Subscription.hasMany(models.Invoice, {
        foreignKey: "subscriptionId",
        as: "invoices",
        onDelete: "CASCADE",
      });
    }
  }

  const Subscription = initModel<Subscription, SubscriptionStatics>(
    SubscriptionModel,
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
      planId: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "basic",
      },
      status: {
        type: DataTypes.ENUM(...SUBSCRIPTION_STATUSES),
        allowNull: false,
        defaultValue: "Active",
      },
      billingCycle: {
        type: DataTypes.ENUM(...BILLING_CYCLES),
        allowNull: false,
        defaultValue: "Monthly",
      },
      currentPeriodStart: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      currentPeriodEnd: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      stripeCustomerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      stripeSubscriptionId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Subscription",
      tableName: "subscriptions",
      timestamps: true,
      underscored: true,
    },
  );

  return Subscription;
};

export = defineModel;
