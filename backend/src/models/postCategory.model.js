/**
 * PostCategory Model — join table for the Post ↔ Category many-to-many.
 * Used as the `through` model for belongsToMany on both sides.
 */

const defineModel = (db, DataTypes) => {
  const PostCategory = db.define(
    "PostCategory",
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
    },
  );

  return PostCategory;
};

module.exports = defineModel;
