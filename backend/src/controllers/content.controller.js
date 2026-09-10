/**
 * Content CMS controller — thin wrappers over content.service.
 * Admin write handlers set createdBy from the authenticated super-admin.
 */

const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const contentService = require("../services/content.service");

// ---- POSTS (admin) ----
exports.listPosts = asyncHandler(async (req, res) => {
  const result = await contentService.listPosts(req.query);
  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

exports.getPost = asyncHandler(async (req, res) => {
  const result = await contentService.getPostById(req.params.id);
  success(res, result.data, null, result.message, result.status);
});

exports.createPost = asyncHandler(async (req, res) => {
  const result = await contentService.createPost(req.body, req.user.id);
  success(res, result.data, null, result.message, result.status);
});

exports.updatePost = asyncHandler(async (req, res) => {
  const result = await contentService.updatePost(req.params.id, req.body);
  success(res, result.data, null, result.message, result.status);
});

exports.deletePost = asyncHandler(async (req, res) => {
  const result = await contentService.deletePost(req.params.id);
  success(res, null, null, result.message, result.status);
});

exports.checkSlug = asyncHandler(async (req, res) => {
  const result = await contentService.checkSlug(req.query.slug, req.query.excludeId);
  success(res, result.data, null, result.message, result.status);
});

// ---- POSTS (public) ----
exports.listPublishedPosts = asyncHandler(async (req, res) => {
  const result = await contentService.listPublishedPosts(req.query);
  success(res, result.data.rows, result.data.meta, result.message, result.status);
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
  const result = await contentService.createCategory(req.body);
  success(res, result.data, null, result.message, result.status);
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const result = await contentService.updateCategory(req.params.id, req.body);
  success(res, result.data, null, result.message, result.status);
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const result = await contentService.deleteCategory(req.params.id);
  success(res, null, null, result.message, result.status);
});
