/**
 * TenantHierarchy Model
 *
 * Materialized-path representation of the tenant tree, enabling efficient
 * ancestor/descendant/subtree queries without recursive CTEs. One row per
 * tenant that participates in a hierarchy.
 *
 * Note: this table carries a `tenantId` and is therefore subject to the global
 * tenant-isolation hooks / RLS. Cross-tenant tree traversal (a parent listing
 * children that live under different tenant ids) must run in a SUPER_ADMIN /
 * system context so the isolation filter does not hide sibling rows.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from tenantHierarchy.model.js with no behaviour
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

/** A TenantHierarchy row (attributes, included associations, instance methods). Types only: emits nothing. */
interface TenantHierarchy extends Model<
  InferAttributes<TenantHierarchy>,
  InferCreationAttributes<TenantHierarchy>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  tenantCode: string;
  parentCode: string | null;
  /** Materialized path. */
  path: string;
  depth: CreationOptional<number>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface TenantHierarchyStatics {
  associate: (models: Models) => void;
}

type DefineTenantHierarchy = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<TenantHierarchy, TenantHierarchyStatics>;

/** Define the TenantHierarchy model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTenantHierarchy = (db, DataTypes) => {
  const TenantHierarchy = initModel<TenantHierarchy, TenantHierarchyStatics>(
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
        onDelete: "RESTRICT",
      },
      // Denormalized code of this tenant (unique key used for parent/child links).
      tenantCode: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      // Code of the parent tenant; null for a root.
      parentCode: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      // Materialized path, e.g. "/acme/acme_001". Lowercased codes joined by "/".
      path: {
        type: DataTypes.STRING(1024),
        allowNull: false,
      },
      depth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "tenant_hierarchies",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"], unique: true },
        { fields: ["tenant_code"], unique: true },
        { fields: ["parent_code"] },
        { fields: ["path"] },
      ],
      modelName: "TenantHierarchy",
      sequelize: db,
    },
  );

  TenantHierarchy.associate = (models: Models): void => {
    TenantHierarchy.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
  };

  return TenantHierarchy;
};

export = defineModel;
