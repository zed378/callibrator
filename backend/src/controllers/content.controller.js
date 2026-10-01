/**
 * Content CMS controller — thin wrappers over content.service.
 * Admin write handlers set createdBy from the authenticated super-admin.
 */

const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const contentService = require("../services/content.service");
const contentMediaService = require("../services/contentMedia.service");
const { auditPrincipal } = require("../utils/auditPrincipal.util");

/** P6-11 — the audit actor of a CMS change: the principal and the caller's tenant. */
const contentActor = (req) => ({ ...auditPrincipal(req), tenantId: req.user.tenantId });

// ---- POSTS (admin) ----
exports.listPosts = asyncHandler(async (req, res) => {
  const result = await contentService.listPosts(req.query);
  // A-297: the service answers rows in `data` and pagination in a top-level `meta`.
  success(res, result.data, result.meta, result.message, result.status);
});

exports.getPost = asyncHandler(async (req, res) => {
  const result = await contentService.getPostById(req.params.id);
  success(res, result.data, null, result.message, result.status);
});

exports.createPost = asyncHandler(async (req, res) => {
  const result = await contentService.createPost(req.body, req.user.id, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

exports.updatePost = asyncHandler(async (req, res) => {
  const result = await contentService.updatePost(req.params.id, req.body, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

exports.deletePost = asyncHandler(async (req, res) => {
  const result = await contentService.deletePost(req.params.id, contentActor(req));
  success(res, null, null, result.message, result.status);
});

exports.checkSlug = asyncHandler(async (req, res) => {
  const result = await contentService.checkSlug(req.query.slug, req.query.excludeId);
  success(res, result.data, null, result.message, result.status);
});

// ---- POSTS (public) ----
exports.listPublishedPosts = asyncHandler(async (req, res) => {
  const result = await contentService.listPublishedPosts(req.query);
  // A-297: the service answers rows in `data` and pagination in a top-level `meta`.
  success(res, result.data, result.meta, result.message, result.status);
});

exports.getPublishedPost = asyncHandler(async (req, res) => {
  const result = await contentService.getPublishedPostBySlug(req.params.slug);
  success(res, result.data, null, result.message, result.status);
});

// ---- CATEGORIES ----
exports.listCategories = asyncHandler(async (req, res) => {
  const result = await contentService.listCategories();
  success(res, result.data, null, result.message, result.status);
});

exports.createCategory = asyncHandler(async (req, res) => {
  const result = await contentService.createCategory(req.body, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const result = await contentService.updateCategory(req.params.id, req.body, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const result = await contentService.deleteCategory(req.params.id, contentActor(req));
  success(res, null, null, result.message, result.status);
});

// ---- MEDIA (admin) — ADR-042 step 3: CMS images are the public class ----
// POST /api/v1/content/media (multipart: file)
exports.uploadMedia = asyncHandler(async (req, res) => {
  // A-282 (ADR-100): an API key (content scopes) is audited as system:api-key.
  const data = await contentMediaService.recordMediaUpload(req.file, {
    ...auditPrincipal(req),
    tenantId: req.user.tenantId,
  });
  success(res, data, null, "Media uploaded", 201);
});
