// D-17 — NO tenant column, so the global tenant hooks never scope this model: the permission matrix of a global role (D-16). Every write route is SUPERADMIN-only.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * RoleMenuPermission Model
 *
 * Maps permissions (read/write) on menu groups to roles.
 * Each record defines whether a role has read or write access
 * to a specific menu group.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from roleMenuPermission.model.js with no behaviour
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
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A RoleMenuPermission row (attributes, included associations, instance methods). Types only: emits nothing. */
interface RoleMenuPermission extends Model<
  InferAttributes<RoleMenuPermission>,
  InferCreationAttributes<RoleMenuPermission>
> {
  id: CreationOptional<string>;
  roleId: string;
  menuGroupId: string;
  /** read | write, validated by isIn. */
  permissionType: CreationOptional<string>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  role?: NonAttribute<ModelInstance<"Role">>;
  menu?: NonAttribute<ModelInstance<"MenuGroup">>;
}

interface RoleMenuPermissionStatics {
  associate: (models: Models) => void;
}

type DefineRoleMenuPermission = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<RoleMenuPermission, RoleMenuPermissionStatics>;

/** Define the RoleMenuPermission model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineRoleMenuPermission = (db, DataTypes) => {
  const RoleMenuPermission = initModel<
    RoleMenuPermission,
    RoleMenuPermissionStatics
  >(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "roles", key: "id" },
        onDelete: "CASCADE",
      },
      menuGroupId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "menu_groups", key: "id" },
        onDelete: "CASCADE",
      },
      permissionType: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "read",
        validate: {
          isIn: [["read", "write"]],
        },
      },
    },
    {
      tableName: "role_menu_permissions",
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["role_id", "menu_group_id"],
          unique: true,
        },
        { fields: ["role_id"] },
        { fields: ["menu_group_id"] },
      ],
      paranoid: false,
      modelName: "RoleMenuPermission",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  RoleMenuPermission.associate = (models: Models): void => {
    // RoleMenuPermission -> Role
    RoleMenuPermission.belongsTo(models.Role, {
      foreignKey: "roleId",
      as: "role",
      onDelete: "CASCADE",
    });
    // RoleMenuPermission -> MenuGroup
    RoleMenuPermission.belongsTo(models.MenuGroup, {
      foreignKey: "menuGroupId",
      as: "menu",
      onDelete: "CASCADE",
    });
  };

  return RoleMenuPermission;
};

export = defineModel;
