// D-17 — NO tenant column, so the global tenant hooks never scope this model: platform CMS, global by design; slugs are unique platform-wide on purpose.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Post Model — Content CMS (Blog & News)
 *
 * PLATFORM-GLOBAL content (NOT tenant-scoped): one HDC marketing blog/news,
 * authored by super-admins and shown on the public /blog & /news pages.
 * `contentHtml` holds sanitized WYSIWYG HTML. A post can belong to many
 * categories (belongsToMany through PostCategory).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from post.model.js with no behaviour
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
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `type` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const POST_TYPES = ["BLOG", "NEWS"] as const;

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const POST_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

/** A Post row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Post extends Model<
  InferAttributes<Post>,
  InferCreationAttributes<Post>
> {
  id: CreationOptional<string>;
  type: CreationOptional<(typeof POST_TYPES)[number]>;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  /** Sanitized WYSIWYG HTML (cleaned server-side on write). */
  contentHtml: string | null;
  status: CreationOptional<(typeof POST_STATUSES)[number]>;
  publishedAt: Date | null;
  authorName: string | null;
  authorRole: string | null;
  authorAvatarUrl: string | null;
  readingMinutes: CreationOptional<number>;
  featured: CreationOptional<boolean>;
  createdBy: UserId | null;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  categories?: NonAttribute<ModelInstance<"Category">[]>;
  author?: NonAttribute<ModelInstance<"User">>;

  softDelete(): Promise<Post>;
}

interface PostStatics {
  associate: (models: Models) => void;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefinePost = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Post, PostStatics>;

/** Define the Post model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefinePost = (db, DataTypes) => {
  const Post = initModel<Post, PostStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM(...POST_TYPES),
        allowNull: false,
        defaultValue: "BLOG",
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // URL-safe unique identifier (stable across the CMS/public boundary).
      slug: {
        type: DataTypes.STRING(280),
        allowNull: false,
      },
      excerpt: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      coverImageUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // Sanitized WYSIWYG HTML (cleaned server-side on write).
      contentHtml: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...POST_STATUSES),
        allowNull: false,
        defaultValue: "DRAFT",
      },
      publishedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      authorName: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      authorRole: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      authorAvatarUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      readingMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      featured: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "posts",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["slug"], unique: true },
        { fields: ["type"] },
        { fields: ["status"] },
        { fields: ["is_deleted"] },
        { fields: ["published_at"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Post",
      sequelize: db,
    },
  );

  // Soft-delete: set the ATTRIBUTE (isDeleted) so save() persists it.
  Post.prototype.softDelete = async function (this: Post): Promise<Post> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Post.associate = (models: Models): void => {
    Post.belongsToMany(models.Category, {
      through: models.PostCategory,
      foreignKey: "postId",
      otherKey: "categoryId",
      as: "categories",
    });
    Post.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "author",
      onDelete: "SET NULL",
    });
  };

  return Post;
};

export = defineModel;
