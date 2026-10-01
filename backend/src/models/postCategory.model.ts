// D-17 — NO tenant column, so the global tenant hooks never scope this model: join of two global CMS tables.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * PostCategory Model — join table for the Post ↔ Category many-to-many.
 * Used as the `through` model for belongsToMany on both sides.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from postCategory.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { initModel, type TypedModel } from "./initModel";

/** A PostCategory row (attributes, included associations, instance methods). Types only: emits nothing. */
interface PostCategory extends Model<
  InferAttributes<PostCategory>,
  InferCreationAttributes<PostCategory>
> {
  id: CreationOptional<string>;
  postId: string;
  categoryId: string;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

type DefinePostCategory = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<PostCategory>;

/** Define the PostCategory model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefinePostCategory = (db, DataTypes) => {
  const PostCategory = initModel<PostCategory>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      postId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "posts", key: "id" },
        onDelete: "CASCADE",
      },
      categoryId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "categories", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "post_categories",
      timestamps: true,
      underscored: true,
      paranoid: false,
      indexes: [
        { fields: ["post_id", "category_id"], unique: true },
        { fields: ["post_id"] },
        { fields: ["category_id"] },
      ],
      modelName: "PostCategory",
      sequelize: db,
    },
  );

  return PostCategory;
};

export = defineModel;
