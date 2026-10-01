/**
 * CustomDomain Model
 *
 * Per-tenant custom domains / vanity subdomains. A tenant may register multiple
 * domains; one may be flagged isDefault. Domain ownership is verified via a DNS
 * TXT record before a domain becomes active.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from customDomain.model.js with no behaviour
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
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `domainType` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const DOMAIN_TYPES = ["custom", "subdomain", "vanity"] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const DOMAIN_STATUSES = [
  "pending_verification",
  "active",
  "verification_failed",
  "deleting",
  "deleted",
] as const;

/** A CustomDomain row (attributes, included associations, instance methods). Types only: emits nothing. */
interface CustomDomain extends Model<
  InferAttributes<CustomDomain>,
  InferCreationAttributes<CustomDomain>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  /** Stored lower-case; uniqueness is two partial indexes (migration 0070), not a column constraint. */
  domain: string;
  domainType: CreationOptional<(typeof DOMAIN_TYPES)[number]>;
  status: CreationOptional<(typeof DOMAIN_STATUSES)[number]>;
  isDefault: CreationOptional<boolean>;
  sslEnabled: CreationOptional<boolean>;
  verificationToken: string | null;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface CustomDomainStatics {
  associate: (models: Models) => void;
}

type DefineCustomDomain = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<CustomDomain, CustomDomainStatics>;

/** Define the CustomDomain model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineCustomDomain = (db, DataTypes) => {
  const CustomDomain = initModel<CustomDomain, CustomDomainStatics>(
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
      // A-223 — NOT unique on its own. It was, globally: a removed domain is a
      // soft delete (status `deleted`, kept for the audit trail), so removing a
      // domain and adding it again — by the same tenant or its new owner — hit
      // the index and answered 500. Uniqueness is two partial indexes, created
      // by migration 0070 (a model cannot declare an expression index that
      // db.sync() would build before the migrations run):
      //   custom_domains_domain_active_uq        (lower(domain)) WHERE status = 'active'
      //   custom_domains_tenant_domain_live_uq   (tenant_id, lower(domain)) WHERE status <> 'deleted'
      // Stored lower-case (customDomains.service#addDomain).
      domain: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      domainType: {
        type: DataTypes.ENUM(...DOMAIN_TYPES),
        allowNull: false,
        defaultValue: "subdomain",
      },
      status: {
        type: DataTypes.ENUM(...DOMAIN_STATUSES),
        allowNull: false,
        defaultValue: "pending_verification",
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sslEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      verificationToken: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      verifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastCheckedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "custom_domains",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["status"] }],
      modelName: "CustomDomain",
      sequelize: db,
    },
  );

  CustomDomain.associate = (models: Models): void => {
    CustomDomain.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return CustomDomain;
};

export = defineModel;
