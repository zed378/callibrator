// D-17 — NO tenant column, so the global tenant hooks never scope this model: platform navigation taxonomy, global by design. Every write route is SUPERADMIN-only (D-16).
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * MenuGroup Model
 *
 * Top-level navigation menu groups.
 * Used for RBAC menu-based access control via RoleMenuPermission.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from menuGroup.model.js with no behaviour
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

/** A MenuGroup row (attributes, included associations, instance methods). Types only: emits nothing. */
interface MenuGroup extends Model<
  InferAttributes<MenuGroup>,
  InferCreationAttributes<MenuGroup>
> {
  id: CreationOptional<string>;
  name: string;
  slug: string;
  icon: string | null;
  parentId: string | null;
  sortOrder: CreationOptional<number | null>;
  isActive: CreationOptional<boolean | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  parent?: NonAttribute<ModelInstance<"MenuGroup">>;
  children?: NonAttribute<ModelInstance<"MenuGroup">[]>;
  rolePermissions?: NonAttribute<ModelInstance<"RoleMenuPermission">[]>;
}

interface MenuGroupStatics {
  associate: (models: Models) => void;
}

type DefineMenuGroup = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<MenuGroup, MenuGroupStatics>;

/** Define the MenuGroup model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineMenuGroup = (db, DataTypes) => {
  const MenuGroup = initModel<MenuGroup, MenuGroupStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      icon: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      parentId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "menu_groups", key: "id" },
        onDelete: "SET NULL",
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "menu_groups",
      timestamps: true,
      paranoid: false,
      underscored: true,
      indexes: [
        { fields: ["slug"] },
        { fields: ["is_active"] },
        { fields: ["parent_id"] },
      ],
      modelName: "MenuGroup",
      sequelize: db,
    },
  );

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  MenuGroup.associate = (models: Models): void => {
    // Self-referencing parent menu group
    MenuGroup.belongsTo(MenuGroup, {
      foreignKey: "parentId",
      as: "parent",
      onDelete: "SET NULL",
    });
    // Children
    MenuGroup.hasMany(MenuGroup, {
      foreignKey: "parentId",
      as: "children",
      onDelete: "SET NULL",
    });
    // MenuGroup -> RoleMenuPermission (hasMany)
    MenuGroup.hasMany(models.RoleMenuPermission, {
      foreignKey: "menuGroupId",
      as: "rolePermissions",
      onDelete: "CASCADE",
    });
  };

  return MenuGroup;
};

export = defineModel;
