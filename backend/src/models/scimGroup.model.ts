/**
 * ScimGroup Model — a SCIM 2.0 Group, owned by ONE tenant (ADR-053, A-38/A-39).
 *
 * Until 2026-09-24 a SCIM Group WAS a row in `roles`, and roles are global:
 * `GET /Groups` listed every tenant's groups, `POST /Groups` answered 409 for a
 * name another tenant held, and `DELETE /Groups/:id` destroyed a role for every
 * tenant whose users held it. A group is now this tenant-owned row, which MAPS
 * to an existing role (`roleId`) — it never creates or deletes one.
 *
 *  - `displayName` is stored as the IdP sent it and compared case-insensitively:
 *    UNIQUE (tenant_id, lower(display_name)), built by migration 0042 only (the
 *    0024/0026 pattern — db.sync() runs before migrations at boot).
 *  - `roleId` is NULL for an unmapped group. An unmapped group grants nothing,
 *    and says so: membership writes to it are refused with a 409, and every
 *    response carries the mapping. UNIQUE (tenant_id, role_id), also in 0042,
 *    because membership is derived — the tenant's users whose roleId is the
 *    group's role — and two groups on one role would share members.
 *
 * Tenant-scoped: the global hooks confine every query to the caller's tenant,
 * and the service also passes tenantId explicitly (super admins skip the hooks).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from scimGroup.model.js with no behaviour
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

/** A ScimGroup row (attributes, included associations, instance methods). Types only: emits nothing. */
interface ScimGroup extends Model<
  InferAttributes<ScimGroup>,
  InferCreationAttributes<ScimGroup>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  displayName: string;
  /** NULL = an unmapped group, which grants nothing. */
  roleId: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  role?: NonAttribute<ModelInstance<"Role">>;
}

interface ScimGroupStatics {
  associate: (models: Models) => void;
}

type DefineScimGroup = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<ScimGroup, ScimGroupStatics>;

/** Define the ScimGroup model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineScimGroup = (db, DataTypes) => {
  const ScimGroup = initModel<ScimGroup, ScimGroupStatics>(
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
      displayName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "roles", key: "id" },
        onDelete: "RESTRICT",
      },
    },
    {
      tableName: "scim_groups",
      timestamps: true,
      paranoid: false,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["role_id"] }],
      modelName: "ScimGroup",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  ScimGroup.associate = (models: Models): void => {
    ScimGroup.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    ScimGroup.belongsTo(models.Role, {
      foreignKey: "roleId",
      as: "role",
      onDelete: "RESTRICT",
    });
  };

  return ScimGroup;
};

export = defineModel;
