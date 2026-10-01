// D-17 — NO tenant column, so the global tenant hooks never scope this model: platform CMS taxonomy, global by design.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Category Model — Content CMS
 *
 * Platform-global content categories (shared by blog & news). A post can have
 * many categories (belongsToMany through PostCategory).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from category.model.js with no behaviour
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
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Category row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Category extends Model<
  InferAttributes<Category>,
  InferCreationAttributes<Category>
> {
  id: CreationOptional<string>;
  name: string;
  slug: string;
  description: string | null;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  posts?: NonAttribute<ModelInstance<"Post">[]>;

  softDelete(): Promise<Category>;
}

interface CategoryStatics {
  associate: (models: Models) => void;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineCategory = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Category, CategoryStatics>;

/** Define the Category model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineCategory = (db, DataTypes) => {
  const Category = initModel<Category, CategoryStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(140),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "categories",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ["slug"], unique: true }, { fields: ["is_deleted"] }],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Category",
      sequelize: db,
    },
  );

  Category.prototype.softDelete = async function (
    this: Category,
  ): Promise<Category> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Category.associate = (models: Models): void => {
    Category.belongsToMany(models.Post, {
      through: models.PostCategory,
      foreignKey: "categoryId",
      otherKey: "postId",
      as: "posts",
    });
  };

  return Category;
};

export = defineModel;
