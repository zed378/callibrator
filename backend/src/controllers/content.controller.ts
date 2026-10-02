/**
 * Content CMS controller — thin wrappers over content.service.
 * Admin write handlers set createdBy from the authenticated super-admin.
 *
 * P9-18 (ADR-087): converted from content.controller.js, behaviour unchanged.
 * `req.user` is read without a guard on the admin routes (`auth` runs first;
 * the public routes never read it), the bodies arrive validated, and the query
 * values are passed raw (the service coerces them). The casts are typing only.
 * The services are read through their module objects at call time; the
 * utilities are captured at load, as the `.js` destructured them. `export =`
 * keeps the exact object `require()` returned (the same keys, in the same
 * order).
 */
import type { Request, Response } from "express";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import contentService from "../services/content.service";
import contentMediaService from "../services/contentMedia.service";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;

type Service = typeof contentService;
/** The service method's N-th parameter (what the handler passes it). */
type Arg<K extends keyof Service, N extends number> = Service[K] extends (...args: infer A) => unknown ? A[N] : never;

/** The principal `auth` set (read without a guard, as before). */
interface ContentPrincipal {
  tenantId: string;
  id: string;
}

const principal = (req: Request): ContentPrincipal => req.user as ContentPrincipal;

/** P6-11 — the audit actor of a CMS change: the principal and the caller's tenant. */
const contentActor = (req: Request): Arg<"updatePost", 2> => ({ ...auditPrincipal(req), tenantId: principal(req).tenantId });

// ---- POSTS (admin) ----
const listPosts = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.listPosts(req.query);
  // A-297: the service answers rows in `data` and pagination in a top-level `meta`.
  success(res, result.data, result.meta, result.message, result.status);
});

const getPost = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.getPostById(req.params["id"]);
  success(res, result.data, null, result.message, result.status);
});

const createPost = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.createPost(req.body as Arg<"createPost", 0>, principal(req).id as Arg<"createPost", 1>, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

const updatePost = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.updatePost(req.params["id"], req.body as Arg<"updatePost", 1>, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

const deletePost = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.deletePost(req.params["id"], contentActor(req));
  success(res, null, null, result.message, result.status);
});

const checkSlug = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.checkSlug(req.query["slug"], req.query["excludeId"]);
  success(res, result.data, null, result.message, result.status);
});

// ---- POSTS (public) ----
const listPublishedPosts = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.listPublishedPosts(req.query);
  // A-297: the service answers rows in `data` and pagination in a top-level `meta`.
  success(res, result.data, result.meta, result.message, result.status);
});

const getPublishedPost = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.getPublishedPostBySlug(req.params["slug"]);
  success(res, result.data, null, result.message, result.status);
});

// ---- CATEGORIES ----
const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const result = await contentService.listCategories();
  success(res, result.data, null, result.message, result.status);
});

const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.createCategory(req.body as Arg<"createCategory", 0>, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.updateCategory(req.params["id"], req.body as Arg<"updateCategory", 1>, contentActor(req));
  success(res, result.data, null, result.message, result.status);
});

const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const result = await contentService.deleteCategory(req.params["id"], contentActor(req));
  success(res, null, null, result.message, result.status);
});

// ---- MEDIA (admin) — ADR-042 step 3: CMS images are the public class ----
// POST /api/v1/content/media (multipart: file)
const uploadMedia = asyncHandler(async (req: Request, res: Response) => {
  // A-282 (ADR-100): an API key (content scopes) is audited as system:api-key.
  const data = await contentMediaService.recordMediaUpload(req.file, {
    ...auditPrincipal(req),
    tenantId: principal(req).tenantId,
  });
  success(res, data, null, "Media uploaded", 201);
});

const controller = {
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  checkSlug,
  listPublishedPosts,
  getPublishedPost,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadMedia,
};

export = controller;
