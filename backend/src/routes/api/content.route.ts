/**
 * The CMS: `/api/v1/content` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from content.route.js. Every route and middleware
 * is in the same order as before (checked against the mounted route table). The
 * contract is code-first: content.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  createCategory,
  createPost,
  updateCategory,
  updatePost,
} from "../../validators/content.validator";
import contentController from "../../controllers/content.controller";
import {
  upload,
  PUBLIC_UPLOAD_FOLDERS,
  PUBLIC_IMAGE_MIMES,
  PUBLIC_IMAGE_EXTS,
} from "../../utils/upload.util";

// `Router` is `express.Router` (the same function).
const router = Router();

/**
 * Content CMS routes — Blog & News (platform-global).
 *
 * PUBLIC read endpoints (published only, no auth) are registered BEFORE the
 * admin `:id` routes so they aren't shadowed. Admin writes require the
 * "content" menu permission; SUPER_ADMIN bypasses. Content is NOT tenant-scoped,
 * so `checkTenant` is intentionally omitted.
 *
 * The contract is code-first (content.openapi.ts). A JSDoc `swagger` tags block that
 * stood here was never read into the document (the builder took only paths and
 * components from JSDoc) and was removed with swagger-jsdoc (P9-24, 2026-10-02).
 */

// ---------------------------------------------------------------------------
// PUBLIC (no auth) — published content for the marketing /blog & /news pages
// ---------------------------------------------------------------------------

router.get("/posts/public", contentController.listPublishedPosts);

router.get("/posts/public/:slug", contentController.getPublishedPost);

router.get("/categories/public", contentController.listCategories);

// ---------------------------------------------------------------------------
// ADMIN — posts (super-admin authored)
// ---------------------------------------------------------------------------

router.get("/posts", auth, dynamicAccess("content", "read"), contentController.listPosts);

router.get("/slug-check", auth, dynamicAccess("content", "read"), contentController.checkSlug);

router.post(
  "/media",
  auth,
  dynamicAccess("content", "create"),
  upload({
    folder: PUBLIC_UPLOAD_FOLDERS.CMS,
    allowedMimes: PUBLIC_IMAGE_MIMES,
    allowedExtensions: PUBLIC_IMAGE_EXTS,
    maxFileSize: 5 * 1024 * 1024,
  }),
  contentController.uploadMedia,
);

router.post(
  "/posts",
  auth,
  dynamicAccess("content", "create"),
  validate(createPost),
  contentController.createPost,
);

router.get(
  "/posts/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "read"),
  contentController.getPost,
);

router.patch(
  "/posts/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "update"),
  validate(updatePost),
  contentController.updatePost,
);

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

router.get("/categories", auth, dynamicAccess("content", "read"), contentController.listCategories);

router.post(
  "/categories",
  auth,
  dynamicAccess("content", "create"),
  validate(createCategory),
  contentController.createCategory,
);

router.patch(
  "/categories/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "update"),
  validate(updateCategory),
  contentController.updateCategory,
);

router.delete(
  "/categories/:id",
  auth,
  validateUuid("id"),
  dynamicAccess("content", "delete"),
  contentController.deleteCategory,
);

export = router;
