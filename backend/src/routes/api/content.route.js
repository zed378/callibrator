/**
 * Content CMS routes — Blog & News (platform-global).
 *
 * PUBLIC read endpoints (published only, no auth) are registered BEFORE the
 * admin `:id` routes so they aren't shadowed. Admin writes require the
 * "content" menu permission; SUPER_ADMIN bypasses. Content is NOT tenant-scoped,
 * so `checkTenant` is intentionally omitted.
 *
 * @swagger
 * tags:
 *   name: Content
 *   description: Blog & News content management (platform-global, super-admin authored)
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const contentValidator = require("../../validators/content.validator");
const contentController = require("../../controllers/content.controller");

// ---------------------------------------------------------------------------
// PUBLIC (no auth) — published content for the marketing /blog & /news pages
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/content/posts/public:
 *   get:
 *     summary: List published posts (public)
 *     description: Public, unauthenticated list of PUBLISHED blog/news posts for the marketing site.
 *     tags: [Content]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [BLOG, NEWS, blog, news]
 *       - in: query
 *         name: category
 *         description: Category slug filter
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Published posts retrieved successfully
 */
router.get("/posts/public", contentController.listPublishedPosts);

/**
 * @swagger
 * /api/v1/content/posts/public/{slug}:
 *   get:
 *     summary: Get a published post by slug (public)
 *     description: Public, unauthenticated fetch of a single PUBLISHED post (with sanitized HTML body and categories).
 *     tags: [Content]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Post retrieved successfully
 *       404:
 *         description: Post not found
 */
router.get("/posts/public/:slug", contentController.getPublishedPost);

/**
 * @swagger
 * /api/v1/content/categories/public:
 *   get:
 *     summary: List categories (public)
 *     description: Public, unauthenticated list of content categories for the marketing site filters.
 *     tags: [Content]
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 */
router.get("/categories/public", contentController.listCategories);

// ---------------------------------------------------------------------------
// ADMIN — posts (super-admin authored)
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/content/posts:
 *   get:
 *     summary: List all posts (admin)
 *     description: Lists all posts across every status. Requires read access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [BLOG, NEWS]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, PUBLISHED, ARCHIVED]
 *       - in: query
 *         name: category
 *         description: Category slug filter
 *         schema:
 *           type: string
 *       - in: query
 *         name: find
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Posts retrieved successfully
 */
router.get("/posts", auth, dynamicAccess("content", "read"), contentController.listPosts);

/**
 * @swagger
 * /api/v1/content/slug-check:
 *   get:
 *     summary: Check slug availability (admin)
 *     description: Normalizes a slug and reports whether it is free, plus a guaranteed-unique suggestion. Requires read access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: slug
 *         required: true
 *         description: Raw slug or title text to normalize and check
 *         schema:
 *           type: string
 *       - in: query
 *         name: excludeId
 *         description: Post id to exclude (so a post keeps its own slug while editing)
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Slug availability result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     slug:
 *                       type: string
 *                     available:
 *                       type: boolean
 *                     suggestion:
 *                       type: string
 */
router.get("/slug-check", auth, dynamicAccess("content", "read"), contentController.checkSlug);

/**
 * @swagger
 * /api/v1/content/posts:
 *   post:
 *     summary: Create a post (admin)
 *     description: Creates a blog or news post. Body HTML is sanitized server-side. Requires create access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, title]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [BLOG, NEWS]
 *               title:
 *                 type: string
 *               slug:
 *                 type: string
 *               excerpt:
 *                 type: string
 *               coverImageUrl:
 *                 type: string
 *               contentHtml:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [DRAFT, PUBLISHED, ARCHIVED]
 *               publishedAt:
 *                 type: string
 *                 format: date-time
 *               authorName:
 *                 type: string
 *               authorRole:
 *                 type: string
 *               authorAvatarUrl:
 *                 type: string
 *               featured:
 *                 type: boolean
 *               categoryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       201:
 *         description: Post created successfully
 */
router.post(
  "/posts",
  auth,
  dynamicAccess("content", "create"),
  validate(contentValidator.createPost),
  contentController.createPost,
);

/**
 * @swagger
 * /api/v1/content/posts/{id}:
 *   get:
 *     summary: Get a post by id (admin)
 *     description: Retrieves any post (any status) by id with its categories. Requires read access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Post retrieved successfully
 *       404:
 *         description: Post not found
 */
router.get(
  "/posts/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "read"),
  contentController.getPost,
);

/**
 * @swagger
 * /api/v1/content/posts/{id}:
 *   patch:
 *     summary: Update a post (admin)
 *     description: Updates a post (partial). Body HTML is re-sanitized. Requires update access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [BLOG, NEWS]
 *               title:
 *                 type: string
 *               slug:
 *                 type: string
 *               excerpt:
 *                 type: string
 *               coverImageUrl:
 *                 type: string
 *               contentHtml:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [DRAFT, PUBLISHED, ARCHIVED]
 *               publishedAt:
 *                 type: string
 *                 format: date-time
 *               authorName:
 *                 type: string
 *               authorRole:
 *                 type: string
 *               authorAvatarUrl:
 *                 type: string
 *               featured:
 *                 type: boolean
 *               categoryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Post updated successfully
 *       404:
 *         description: Post not found
 */
router.patch(
  "/posts/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "update"),
  validate(contentValidator.updatePost),
  contentController.updatePost,
);

/**
 * @swagger
 * /api/v1/content/posts/{id}:
 *   delete:
 *     summary: Delete a post (admin)
 *     description: Soft-deletes a post. Requires delete access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Post deleted successfully
 *       404:
 *         description: Post not found
 */
router.delete(
  "/posts/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "delete"),
  contentController.deletePost,
);

// ---------------------------------------------------------------------------
// ADMIN — categories
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/content/categories:
 *   get:
 *     summary: List categories (admin)
 *     description: Lists all content categories. Requires read access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 */
router.get("/categories", auth, dynamicAccess("content", "read"), contentController.listCategories);

/**
 * @swagger
 * /api/v1/content/categories:
 *   post:
 *     summary: Create a category (admin)
 *     description: Creates a content category. Requires create access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Category created successfully
 */
router.post(
  "/categories",
  auth,
  dynamicAccess("content", "create"),
  validate(contentValidator.createCategory),
  contentController.createCategory,
);

/**
 * @swagger
 * /api/v1/content/categories/{id}:
 *   patch:
 *     summary: Update a category (admin)
 *     description: Updates a content category. Requires update access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Category updated successfully
 *       404:
 *         description: Category not found
 */
router.patch(
  "/categories/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "update"),
  validate(contentValidator.updateCategory),
  contentController.updateCategory,
);

/**
 * @swagger
 * /api/v1/content/categories/{id}:
 *   delete:
 *     summary: Delete a category (admin)
 *     description: Soft-deletes a content category. Requires delete access to the Content resource.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Category deleted successfully
 *       404:
 *         description: Category not found
 */
router.delete(
  "/categories/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "delete"),
  contentController.deleteCategory,
);

module.exports = router;
