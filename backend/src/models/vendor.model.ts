// P9-10 (ADR-087 Amendments 7–8): converted from vendor.model.js with no behaviour
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

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const VENDOR_TYPES = ["CalibrationLab", "PartsSupplier", "Other"] as const;

/** The `approvalStatus` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const VENDOR_APPROVAL_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "CONDITIONAL",
] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const VENDOR_STATUSES = ["Active", "Inactive"] as const;

/** A Vendor row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Vendor extends Model<
  InferAttributes<Vendor>,
  InferCreationAttributes<Vendor>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  name: string;
  type: CreationOptional<(typeof VENDOR_TYPES)[number]>;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Q-52 (migration 0106): accepted by the API since P9-22, stored since 2026-09-30. */
  notes: string | null;
  rating: number | null;
  approvalStatus: CreationOptional<(typeof VENDOR_APPROVAL_STATUSES)[number]>;
  scorecard: number | null;
  lastAuditDate: Date | null;
  nextAuditDate: Date | null;
  status: CreationOptional<(typeof VENDOR_STATUSES)[number]>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface VendorStatics {
  associate(models: Models): void;
}

type DefineVendor = (sequelize: Sequelize) => TypedModel<Vendor, VendorStatics>;

/** Define the Vendor model (a fresh class per call). */
const defineModel: DefineVendor = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class VendorModel extends Model {
    static associate(models: Models): void {
      Vendor.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
    }
  }

  const Vendor = initModel<Vendor, VendorStatics>(
    VendorModel,
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
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM(...VENDOR_TYPES),
        allowNull: false,
        defaultValue: "Other",
      },
      contactPerson: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Q-52 (ADR-109 §6, migration 0106): the API accepted `notes` and
      // Sequelize dropped it — there was no attribute and no column.
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      rating: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: {
          min: 0,
          max: 5,
        },
      },
      approvalStatus: {
        type: DataTypes.ENUM(...VENDOR_APPROVAL_STATUSES),
        defaultValue: "PENDING",
        allowNull: false,
        field: "approval_status",
      },
      scorecard: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      lastAuditDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_audit_date",
      },
      nextAuditDate: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "next_audit_date",
      },
      status: {
        type: DataTypes.ENUM(...VENDOR_STATUSES),
        allowNull: false,
        defaultValue: "Active",
      },
    },
    {
      sequelize,
      modelName: "Vendor",
      tableName: "vendors",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return Vendor;
};

export = defineModel;
