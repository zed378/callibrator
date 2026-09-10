/**
 * Post Model — Content CMS (Blog & News)
 *
 * PLATFORM-GLOBAL content (NOT tenant-scoped): one HDC marketing blog/news,
 * authored by super-admins and shown on the public /blog & /news pages.
 * `contentHtml` holds sanitized WYSIWYG HTML. A post can belong to many
 * categories (belongsToMany through PostCategory).
 */

const defineModel = (db, DataTypes) => {
  const Post = db.define(
    "Post",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM("BLOG", "NEWS"),
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
        type: DataTypes.ENUM("DRAFT", "PUBLISHED", "ARCHIVED"),
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
        where: { is_deleted: false },
      },
      scopes: {
        includeDeleted: { where: null },
      },
    },
  );

  // Soft-delete: set the ATTRIBUTE (isDeleted) so save() persists it.
  Post.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Post.associate = (models) => {
    Post.belongsToMany(models.Category, {
      through: models.PostCategory,
      foreignKey: "postId",
      otherKey: "categoryId",
      as: "categories",
    });
    Post.belongsTo(models.User, { foreignKey: "created_by", as: "author" });
  };

  return Post;
};

module.exports = defineModel;
