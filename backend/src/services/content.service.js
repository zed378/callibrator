/**
 * Content CMS service — Blog & News posts + Categories (platform-global,
 * super-admin authored). Bodies are sanitized WYSIWYG HTML. Posts ↔ Categories
 * is many-to-many (belongsToMany through PostCategory).
 */

const { Op } = require("sequelize");
const sanitizeHtml = require("sanitize-html");
const { db } = require("../config");
const { Post, Category } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const slugify = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200) || "post";

// Ensure slug uniqueness against ALL rows (incl. soft-deleted — the unique
// index spans them), appending -2, -3, … as needed.
const ensureUniqueSlug = async (Model, base, excludeId = null) => {
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    const existing = await Model.unscoped().findOne({ where, paranoid: false });
    if (!existing) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
};

const computeReadingMinutes = (html) => {
  const text = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text ? text.split(" ").length : 0;
  return Math.max(1, Math.ceil(words / 200));
};

const SANITIZE_OPTS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "h1",
    "h2",
    "figure",
    "figcaption",
    "u",
    "s",
    "span",
  ]),
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["style"],
  },
  allowedStyles: {
    "*": { "text-align": [/^(left|right|center|justify)$/] },
  },
  allowedSchemes: ["http", "https", "mailto", "data"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  // Drop these tags AND their inner content entirely (don't escape to text).
  nonTextTags: ["script", "style", "textarea", "noscript"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};
const sanitizeContent = (html) => sanitizeHtml(String(html || ""), SANITIZE_OPTS);

const CATEGORY_INCLUDE = {
  model: Category,
  as: "categories",
  through: { attributes: [] },
  attributes: ["id", "name", "slug"],
};

const transformPost = (post) => (post && post.toJSON ? post.toJSON() : post || null);

const findPostWithCategories = (id, publicOnly = false) =>
  Post.findByPk(id, {
    include: [{ ...CATEGORY_INCLUDE, required: false }],
    // All three call sites invoke findPostWithCategories(id) without the second
    // argument, so publicOnly is always the false default and the truthy arm
    // (itself a no-op `exclude: []`) is unreachable.
    ...(/* istanbul ignore next */ publicOnly ? { attributes: { exclude: [] } } : {}),
  });

const paginate = (page, limit) => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  return { safeLimit, offset: (Number(page || 1) - 1) * safeLimit };
};

const listMeta = (count, page, safeLimit) => ({
  total: count,
  page: Number(page || 1),
  limit: safeLimit,
  totalPages: Math.max(1, Math.ceil(count / safeLimit)),
});

const PUBLIC_LIST_ATTRS = [
  "id",
  "type",
  "title",
  "slug",
  "excerpt",
  "coverImageUrl",
  "publishedAt",
  "authorName",
  "authorRole",
  "authorAvatarUrl",
  "readingMinutes",
  "featured",
  "createdAt",
];

// ------------------------------------------------------------------
// POSTS — admin
// ------------------------------------------------------------------
exports.listPosts = async ({ type, status, category, find, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (find) where.title = { [Op.like]: `%${find}%` };
    const { safeLimit, offset } = paginate(page, limit);

    const { count, rows } = await Post.findAndCountAll({
      where,
      include: [
        {
          ...CATEGORY_INCLUDE,
          ...(category ? { where: { slug: category }, required: true } : { required: false }),
        },
      ],
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
    });

    return {
      success: true,
      status: 200,
      message: "Fetch posts successful",
      data: { rows: rows.map(transformPost), count, meta: listMeta(count, page, safeLimit) },
    };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to fetch posts" };
  }
};

exports.getPostById = async (id) => {
  try {
    const post = await findPostWithCategories(id);
    if (!post) throw new AppError(404, "Post not found");
    return { success: true, status: 200, message: "Post retrieved successfully", data: transformPost(post) };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to retrieve post" };
  }
};

exports.createPost = async (data, userId) => {
  const t = await db.transaction();
  try {
    const { categoryIds = [], ...fields } = data;
    const slug = await ensureUniqueSlug(Post, slugify(fields.slug || fields.title));
    const contentHtml = sanitizeContent(fields.contentHtml);
    const publishedAt =
      fields.status === "PUBLISHED" ? fields.publishedAt || new Date() : fields.publishedAt || null;

    const post = await Post.create(
      {
        ...fields,
        slug,
        contentHtml,
        publishedAt,
        readingMinutes: computeReadingMinutes(contentHtml),
        createdBy: userId,
      },
      { transaction: t },
    );

    if (Array.isArray(categoryIds) && categoryIds.length) {
      await post.setCategories(categoryIds, { transaction: t });
    }
    await t.commit();

    const full = await findPostWithCategories(post.id);
    return { success: true, status: 201, message: "Post created successfully", data: transformPost(full) };
  } catch (error) {
    await t.rollback();
    throw { status: error.status || 500, message: error.message || "Failed to create post" };
  }
};

exports.updatePost = async (id, data) => {
  const post = await Post.findByPk(id);
  if (!post) throw new AppError(404, "Post not found");

  const t = await db.transaction();
  try {
    const { categoryIds, ...fields } = data;
    const patch = { ...fields };

    // Slug only changes when explicitly provided (keeps URLs stable on rename).
    if (fields.slug) patch.slug = await ensureUniqueSlug(Post, slugify(fields.slug), post.id);
    if (fields.contentHtml !== undefined) {
      patch.contentHtml = sanitizeContent(fields.contentHtml);
      patch.readingMinutes = computeReadingMinutes(patch.contentHtml);
    }
    // Stamp publishedAt the first time it goes PUBLISHED.
    if (fields.status === "PUBLISHED" && !post.publishedAt && !fields.publishedAt) {
      patch.publishedAt = new Date();
    }

    await post.update(patch, { transaction: t });
    if (Array.isArray(categoryIds)) {
      await post.setCategories(categoryIds, { transaction: t });
    }
    await t.commit();

    const full = await findPostWithCategories(post.id);
    return { success: true, status: 200, message: "Post updated successfully", data: transformPost(full) };
  } catch (error) {
    await t.rollback();
    throw { status: error.status || 500, message: error.message || "Failed to update post" };
  }
};

exports.deletePost = async (id) => {
  try {
    const post = await Post.findByPk(id);
    if (!post) throw new AppError(404, "Post not found");
    await post.softDelete();
    return { success: true, status: 200, message: "Post deleted successfully" };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to delete post" };
  }
};

// Slug availability — returns the normalized slug, whether it's free, and a
// guaranteed-unique suggestion (base, or base-2, base-3…). `excludeId` lets the
// post keep its own slug while editing.
exports.checkSlug = async (rawSlug, excludeId) => {
  const base = slugify(rawSlug || "");
  if (!base || base === "post") {
    return {
      success: true,
      status: 200,
      message: "OK",
      data: { slug: base, available: false, suggestion: base },
    };
  }
  const suggestion = await ensureUniqueSlug(Post, base, excludeId || null);
  return {
    success: true,
    status: 200,
    message: "OK",
    data: { slug: base, available: suggestion === base, suggestion },
  };
};

// ------------------------------------------------------------------
// POSTS — public (published only)
// ------------------------------------------------------------------
exports.listPublishedPosts = async ({ type, category, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const where = { status: "PUBLISHED" };
    if (type) where.type = String(type).toUpperCase();
    const { safeLimit, offset } = paginate(page, limit);

    const { count, rows } = await Post.findAndCountAll({
      where,
      attributes: PUBLIC_LIST_ATTRS,
      include: [
        {
          ...CATEGORY_INCLUDE,
          ...(category ? { where: { slug: category }, required: true } : { required: false }),
        },
      ],
      limit: safeLimit,
      offset,
      order: [
        ["publishedAt", "DESC"],
        ["createdAt", "DESC"],
      ],
      distinct: true,
    });

    return {
      success: true,
      status: 200,
      message: "OK",
      data: { rows: rows.map(transformPost), count, meta: listMeta(count, page, safeLimit) },
    };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to fetch posts" };
  }
};

exports.getPublishedPostBySlug = async (slug) => {
  try {
    const post = await Post.findOne({
      where: { slug, status: "PUBLISHED" },
      attributes: [...PUBLIC_LIST_ATTRS, "contentHtml"],
      include: [CATEGORY_INCLUDE],
    });
    if (!post) throw new AppError(404, "Post not found");
    return { success: true, status: 200, message: "OK", data: transformPost(post) };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to fetch post" };
  }
};

// ------------------------------------------------------------------
// CATEGORIES
// ------------------------------------------------------------------
exports.listCategories = async () => {
  try {
    const rows = await Category.findAll({ order: [["name", "ASC"]] });
    return { success: true, status: 200, message: "OK", data: rows.map((c) => c.toJSON()) };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to fetch categories" };
  }
};

exports.createCategory = async (data) => {
  try {
    const slug = await ensureUniqueSlug(Category, slugify(data.slug || data.name));
    const cat = await Category.create({
      name: data.name,
      description: data.description || null,
      slug,
    });
    return { success: true, status: 201, message: "Category created successfully", data: cat.toJSON() };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to create category" };
  }
};

exports.updateCategory = async (id, data) => {
  try {
    const cat = await Category.findByPk(id);
    if (!cat) throw new AppError(404, "Category not found");
    const patch = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.slug) patch.slug = await ensureUniqueSlug(Category, slugify(data.slug), cat.id);
    await cat.update(patch);
    return { success: true, status: 200, message: "Category updated successfully", data: cat.toJSON() };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to update category" };
  }
};

exports.deleteCategory = async (id) => {
  try {
    const cat = await Category.findByPk(id);
    if (!cat) throw new AppError(404, "Category not found");
    await cat.softDelete();
    return { success: true, status: 200, message: "Category deleted successfully" };
  } catch (error) {
    throw { status: error.status || 500, message: error.message || "Failed to delete category" };
  }
};
