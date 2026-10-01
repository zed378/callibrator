// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its user (scoped). Every query names userId; every route is SUPERADMIN-only.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * UserMenuPermission Model
 *
 * Per-user permission overrides on menu groups. A user normally inherits
 * permissions from their role (role_menu_permissions); rows in this table
 * override that inheritance for a single user:
 *
 *   - permissionType "read"  → user gets read on this menu (regardless of role)
 *   - permissionType "write" → user gets write on this menu (regardless of role)
 *   - permissionType "none"  → user is explicitly DENIED this menu even if
 *                              their role grants it
 *
 * Removing the row restores plain role inheritance.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from userMenuPermission.model.js with no behaviour
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
import type { UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A UserMenuPermission row (attributes, included associations, instance methods). Types only: emits nothing. */
interface UserMenuPermission extends Model<
  InferAttributes<UserMenuPermission>,
  InferCreationAttributes<UserMenuPermission>
> {
  id: CreationOptional<string>;
  userId: UserId;
  menuGroupId: string;
  /** read | write | none (none = an explicit deny), validated by isIn. */
  permissionType: CreationOptional<string>;
  grantedBy: UserId | null;
  notes: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  user?: NonAttribute<ModelInstance<"User">>;
  menu?: NonAttribute<ModelInstance<"MenuGroup">>;
  grantor?: NonAttribute<ModelInstance<"User">>;
}

interface UserMenuPermissionStatics {
  associate: (models: Models) => void;
}

type DefineUserMenuPermission = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<UserMenuPermission, UserMenuPermissionStatics>;

/** Define the UserMenuPermission model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineUserMenuPermission = (db, DataTypes) => {
  const UserMenuPermission = initModel<
    UserMenuPermission,
    UserMenuPermissionStatics
  >(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
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
          isIn: [["read", "write", "none"]],
        },
      },
      grantedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      notes: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "user_menu_permissions",
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["user_id", "menu_group_id"],
          unique: true,
        },
        { fields: ["user_id"] },
        { fields: ["menu_group_id"] },
      ],
      paranoid: false,
      modelName: "UserMenuPermission",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  UserMenuPermission.associate = (models: Models): void => {
    UserMenuPermission.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
      onDelete: "CASCADE",
    });
    UserMenuPermission.belongsTo(models.MenuGroup, {
      foreignKey: "menuGroupId",
      as: "menu",
      onDelete: "CASCADE",
    });
    UserMenuPermission.belongsTo(models.User, {
      foreignKey: "grantedBy",
      as: "grantor",
      onDelete: "SET NULL",
    });
  };

  return UserMenuPermission;
};

export = defineModel;
