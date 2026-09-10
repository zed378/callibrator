/**
 * Category Model — Content CMS
 *
 * Platform-global content categories (shared by blog & news). A post can have
 * many categories (belongsToMany through PostCategory).
 */

const defineModel = (db, DataTypes) => {
  const Category = db.define(
    "Category",
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
      indexes: [
        { fields: ["slug"], unique: true },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        where: { is_deleted: false },
      },
      scopes: {
        includeDeleted: { where: null },
      },
    },
  );

  Category.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Category.associate = (models) => {
    Category.belongsToMany(models.Post, {
      through: models.PostCategory,
      foreignKey: "categoryId",
      otherKey: "postId",
      as: "posts",
    });
  };

  return Category;
};

module.exports = defineModel;
