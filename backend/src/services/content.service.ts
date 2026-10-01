/**
 * Content CMS service — Blog & News posts + Categories (platform-global,
 * super-admin authored). Bodies are sanitized WYSIWYG HTML. Posts ↔ Categories
 * is many-to-many (belongsToMany through PostCategory).
 *
 * P9-18 (ADR-087, Stage C leaves): converted from content.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). `db`, the two models, `AppError` and the two
 * limits are captured once at load, as the `.js` destructured them;
 * `sanitize-html` is the module's function itself (a default import of a
 * CommonJS module).
 *
 * A-297 (its own change, after the conversion): the two lists answer in the
 * response envelope — rows in `data`, pagination in a top-level `meta` — where
 * they used to answer `data: { rows, count, meta }`; and every failure is an
 * `AppError` (an AppError raised here passes through unchanged; anything else
 * is wrapped with its status and message), where the catch blocks used to
 * throw plain `{ status, message }` objects. The wire did not change: the
 * controller already sent `data` and `meta` that way.
 */

import { Op, type BelongsToManySetAssociationsMixin, type CreationAttributes, type Attributes, type Transaction, type WhereOptions } from "sequelize";
import sanitizeHtml from "sanitize-html";
import { contentHtmlPolicy } from "@callibrator/contracts/contentHtml";
import { db as loadedDb } from "../config";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import auditService from "./audit.service";
import { actorChanges, auditEntryActor } from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT, MAX_LIMIT as LOADED_MAX_LIMIT } from "../constants";
import type { UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const db = loadedDb;
const { Post, Category } = models;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const MAX_LIMIT = LOADED_MAX_LIMIT;

type PostRow = ModelInstance<"Post">;
type CategoryRow = ModelInstance<"Category">;

/** Post's belongsToMany(Category) setter, which Sequelize adds at run time. */
type PostWithCategories = PostRow & {
  setCategories: BelongsToManySetAssociationsMixin<CategoryRow, string>;
};

/** The service's answer, in the response envelope (A-297): `meta` is a sibling of `data`. */
interface ServiceResult<T = unknown> {
  success: true;
  status: number;
  message: string;
  data?: T;
  meta?: ListMeta;
}

/** The fields a caught error is read for. */
interface CaughtError {
  status?: unknown;
  message?: unknown;
}

/**
 * A-297 — what a catch block throws: the AppError itself when the service
 * raised one; otherwise an AppError carrying the error's status (500 when it
 * has none) and its message (the fallback when it has none).
 */
const failure = (error: unknown, fallback: string): InstanceType<typeof AppError> => {
  if (error instanceof AppError) {
    return error;
  }
  const e = error as CaughtError;
  const status = Number(e.status) || 500;
  const message = typeof e.message === "string" && e.message ? e.message : fallback;
  return new AppError(status, message);
};

/**
 * P6-11 (A-41 addendum) — who changed the CMS: auditPrincipal(req) plus the
 * caller's tenant, as contentMedia.service records a media upload (an API key
 * with a content scope is `system:api-key`, A-282).
 */
type ContentActor = AuditActorInput & { readonly tenantId?: string | null };

/** The fields of a post an audit row records — never the body (it can be long, and is on the post). */
const POST_AUDIT_FIELDS = ["title", "slug", "status", "type"] as const;

/** The named attributes of a row, as plain values (null when absent). */
const pickFields = (row: object, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

/**
 * P6-11 — a CMS change commits with one audit row in its transaction; a
 * rolled-back change leaves none (logAction re-throws inside a transaction).
 *
 * @param transaction - the change's transaction
 * @param actor - who, and in which tenant
 * @param action - CREATE | UPDATE | DELETE
 * @param resourceType - "Post" or "Category"
 * @param resourceId - the row's id
 * @param changes - { operation, before?, after? }
 * @returns logAction's result
 */
const auditContent = (
  transaction: Transaction,
  actor: ContentActor | null | undefined,
  action: "CREATE" | "UPDATE" | "DELETE",
  resourceType: "Post" | "Category",
  resourceId: string,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId: actor?.tenantId ?? null,
      ...auditEntryActor(actor),
      action,
      resourceType,
      resourceId,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** A post as a caller submits it (the validator shaped it; the service reads these). */
interface PostInput {
  categoryIds?: unknown;
  slug?: unknown;
  title?: unknown;
  contentHtml?: unknown;
  status?: unknown;
  publishedAt?: unknown;
  [field: string]: unknown;
}

/** A category as a caller submits it. */
interface CategoryInput {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
}

/** The list filters, as the controller passes them from the query string. */
interface ListPostsQuery {
  type?: unknown;
  status?: unknown;
  category?: unknown;
  find?: unknown;
  page?: unknown;
  limit?: unknown;
}

/** The two models whose slugs `ensureUniqueSlug` keeps unique. */
type SlugModel = typeof Post | typeof Category;

/**
 * The one call the slug check makes on the unscoped model. Post's and
 * Category's `findOne` differ only in their row type, and the check reads the
 * answer for truth only, so both are viewed through this signature.
 */
interface SlugLookup {
  findOne(options: { where: SlugWhere; paranoid: false }): Promise<unknown>;
}

/** The slug lookup's `where`: the slug, and the row to leave out (when editing). */
interface SlugWhere {
  slug: string;
  id?: unknown;
}

/** The admin list's `where`, built key by key as the `.js` built it. */
interface PostListWhere {
  type?: unknown;
  status?: unknown;
  title?: unknown;
}

/** An update's field patch: the caller's fields, plus what the service derives. */
interface PostPatch {
  slug?: unknown;
  contentHtml?: unknown;
  readingMinutes?: unknown;
  publishedAt?: unknown;
  [field: string]: unknown;
}

/** A category update's patch. */
interface CategoryPatch {
  name?: unknown;
  description?: unknown;
  slug?: unknown;
}

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: `||` fallbacks and String() of caller-supplied values */
const slugify = (str: unknown): string =>
  String(str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200) || "post";

// Ensure slug uniqueness against ALL rows (incl. soft-deleted — the unique
// index spans them), appending -2, -3, … as needed.
const ensureUniqueSlug = async (Model: SlugModel, base: string, excludeId: unknown = null): Promise<string> => {
  let slug = base;
  let n = 1;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the loop ends by returning
  while (true) {
    const where: SlugWhere = { slug };
    if (excludeId) {where.id = { [Op.ne]: excludeId };}
    const existing = await (Model.unscoped() as unknown as SlugLookup).findOne({ where, paranoid: false });
    if (!existing) {return slug;}
    n += 1;
    slug = `${base}-${String(n)}`;
  }
};

const computeReadingMinutes = (html: unknown): number => {
  const text = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text ? text.split(" ").length : 0;
  return Math.max(1, Math.ceil(words / 200));
};

// A-298: the allow-list is the shared contract (@callibrator/contracts/
// contentHtml), which the frontend's ArticleBody applies again at render. It
// dropped the `data:` scheme this list allowed on `<a href>` and `<img src>`.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  ...contentHtmlPolicy(),
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};
const sanitizeContent = (html: unknown): string => sanitizeHtml(String(html || ""), SANITIZE_OPTS);

const CATEGORY_INCLUDE = {
  model: Category,
  as: "categories",
  through: { attributes: [] },
  attributes: ["id", "name", "slug"],
  // D-12: explicit, like every include of a defaultScoped model; each call
  // site below still states its own (a category filter makes it INNER).
  required: false,
};

/** A row's `toJSON()` when it has one; the value itself (or null) otherwise. */
interface MaybeRow {
  toJSON?: () => unknown;
}
/**
 * A-298: a body is sanitized again whenever it is served, not only when it is
 * written, so a body stored under an older policy (before `data:` was dropped)
 * is safe on every read path — the public page, the editor, the API — with
 * no migration. The policy is idempotent: a body already clean is unchanged.
 */
const withSafeBody = (row: unknown): unknown => {
  const body = (row as { contentHtml?: unknown } | null)?.contentHtml;
  return typeof body === "string" ? { ...(row as object), contentHtml: sanitizeContent(body) } : row;
};
const transformPost = (post: unknown): unknown => {
  const p = post as MaybeRow | null | undefined;
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `post && post.toJSON ? post.toJSON() : post || null`
  return withSafeBody(p && p.toJSON ? p.toJSON() : post || null);
};

// A-32/A-18: a `publicOnly` second parameter was never passed by any of the
// three call sites, and its arm (a no-op `exclude: []`) was hidden from coverage.
const findPostWithCategories = (id: unknown): Promise<PostRow | null> =>
  Post.findByPk(id as string, {
    include: [{ ...CATEGORY_INCLUDE, required: false }],
  });

const paginate = (page: unknown, limit: unknown): { safeLimit: number; offset: number } => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  return { safeLimit, offset: (Number(page || 1) - 1) * safeLimit };
};

interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const listMeta = (count: number, page: unknown, safeLimit: number): ListMeta => ({
  total: count,
  page: Number(page || 1),
  limit: safeLimit,
  totalPages: Math.max(1, Math.ceil(count / safeLimit)),
});
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string */

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

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: `||` fallbacks are kept */

// ------------------------------------------------------------------
// POSTS — admin
// ------------------------------------------------------------------
const listPosts = async ({ type, status, category, find, page = 1, limit = DEFAULT_LIMIT }: ListPostsQuery): Promise<ServiceResult<unknown[]>> => {
  try {
    const where: PostListWhere = {};
    if (type) {where.type = type;}
    if (status) {where.status = status;}
    if (find) {where.title = { [Op.like]: `%${find as string}%` };}
    const { safeLimit, offset } = paginate(page, limit);

    const { count, rows } = await Post.findAndCountAll({
      where: where as WhereOptions,
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
      data: rows.map(transformPost),
      meta: listMeta(count, page, safeLimit),
    };
  } catch (error) {
    throw failure(error, "Failed to fetch posts");
  }
};

const getPostById = async (id: unknown): Promise<ServiceResult> => {
  try {
    const post = await findPostWithCategories(id);
    if (!post) {throw new AppError(404, "Post not found");}
    return { success: true, status: 200, message: "Post retrieved successfully", data: transformPost(post) };
  } catch (error) {
    throw failure(error, "Failed to retrieve post");
  }
};

const createPost = async (
  data: PostInput,
  userId: UserId | null | undefined,
  actor: ContentActor | null = { userId: userId ?? null },
): Promise<ServiceResult> => {
  const t: Transaction = await db.transaction();
  try {
    const { categoryIds = [], ...fields } = data;
    const slug = await ensureUniqueSlug(Post, slugify(fields.slug || fields.title));
    const contentHtml = sanitizeContent(fields.contentHtml);
    const publishedAt =
      fields.status === "PUBLISHED" ? fields.publishedAt || new Date() : fields.publishedAt || null;

    const values = {
      ...fields,
      slug,
      contentHtml,
      publishedAt,
      readingMinutes: computeReadingMinutes(contentHtml),
      createdBy: userId,
    };
    // As built: the validated fields are written as the caller sent them.
    const post = await Post.create(values as CreationAttributes<PostRow>, { transaction: t });

    if (Array.isArray(categoryIds) && categoryIds.length) {
      await (post as PostWithCategories).setCategories(categoryIds as string[], { transaction: t });
    }
    await auditContent(t, actor, "CREATE", "Post", post.id, {
      operation: "POST_CREATE",
      after: { ...pickFields(post, POST_AUDIT_FIELDS), categoryIds },
    });
    await t.commit();

    const full = await findPostWithCategories(post.id);
    return { success: true, status: 201, message: "Post created successfully", data: transformPost(full) };
  } catch (error) {
    await t.rollback();
    throw failure(error, "Failed to create post");
  }
};

const updatePost = async (id: unknown, data: PostInput, actor: ContentActor | null = null): Promise<ServiceResult> => {
  const post = await Post.findByPk(id as string);
  if (!post) {throw new AppError(404, "Post not found");}
  const before = pickFields(post, POST_AUDIT_FIELDS);

  const t: Transaction = await db.transaction();
  try {
    const { categoryIds, ...fields } = data;
    const patch: PostPatch = { ...fields };

    // Slug only changes when explicitly provided (keeps URLs stable on rename).
    if (fields.slug) {patch.slug = await ensureUniqueSlug(Post, slugify(fields.slug), post.id);}
    if (fields.contentHtml !== undefined) {
      patch.contentHtml = sanitizeContent(fields.contentHtml);
      patch.readingMinutes = computeReadingMinutes(patch.contentHtml);
    }
    // Stamp publishedAt the first time it goes PUBLISHED.
    if (fields.status === "PUBLISHED" && !post.publishedAt && !fields.publishedAt) {
      patch.publishedAt = new Date();
    }

    // As built: the caller's validated fields are written as sent.
    await post.update(patch as Partial<Attributes<PostRow>>, { transaction: t });
    if (Array.isArray(categoryIds)) {
      await (post as PostWithCategories).setCategories(categoryIds as string[], { transaction: t });
    }
    await auditContent(t, actor, "UPDATE", "Post", post.id, {
      operation: "POST_UPDATE",
      before,
      after: pickFields(post, POST_AUDIT_FIELDS),
      bodyChanged: fields.contentHtml !== undefined,
      ...(Array.isArray(categoryIds) ? { categoryIds } : {}),
    });
    await t.commit();

    const full = await findPostWithCategories(post.id);
    return { success: true, status: 200, message: "Post updated successfully", data: transformPost(full) };
  } catch (error) {
    await t.rollback();
    throw failure(error, "Failed to update post");
  }
};

const deletePost = async (id: unknown, actor: ContentActor | null = null): Promise<ServiceResult> => {
  try {
    const post = await Post.findByPk(id as string);
    if (!post) {throw new AppError(404, "Post not found");}
    // P6-11: softDelete() saves without options and joins this transaction
    // through CLS (config/index.js), as apiKey.service#revokeApiKey relies on.
    await db.transaction(async (transaction: Transaction) => {
      await post.softDelete();
      await auditContent(transaction, actor, "DELETE", "Post", post.id, {
        operation: "POST_DELETE",
        before: pickFields(post, POST_AUDIT_FIELDS),
      });
    });
    return { success: true, status: 200, message: "Post deleted successfully" };
  } catch (error) {
    throw failure(error, "Failed to delete post");
  }
};

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion: string;
}

// Slug availability — returns the normalized slug, whether it's free, and a
// guaranteed-unique suggestion (base, or base-2, base-3…). `excludeId` lets the
// post keep its own slug while editing.
const checkSlug = async (rawSlug: unknown, excludeId: unknown): Promise<ServiceResult<SlugCheck>> => {
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
const listPublishedPosts = async ({ type, category, page = 1, limit = DEFAULT_LIMIT }: ListPostsQuery): Promise<ServiceResult<unknown[]>> => {
  try {
    const where: { status: string; type?: string } = { status: "PUBLISHED" };
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: String() of the query value
    if (type) {where.type = String(type).toUpperCase();}
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
      data: rows.map(transformPost),
      meta: listMeta(count, page, safeLimit),
    };
  } catch (error) {
    throw failure(error, "Failed to fetch posts");
  }
};

const getPublishedPostBySlug = async (slug: unknown): Promise<ServiceResult> => {
  try {
    const where = { slug, status: "PUBLISHED" };
    const post = await Post.findOne({
      // As built: the slug is matched as the caller passed it.
      where: where as WhereOptions,
      attributes: [...PUBLIC_LIST_ATTRS, "contentHtml"],
      // LEFT JOIN (A-90): Category has a defaultScope `where`, so a bare
      // CATEGORY_INCLUDE is required — a published post with no category (or
      // only soft-deleted ones) answered 404 by slug while the list showed it.
      include: [{ ...CATEGORY_INCLUDE, required: false }],
    });
    if (!post) {throw new AppError(404, "Post not found");}
    return { success: true, status: 200, message: "OK", data: transformPost(post) };
  } catch (error) {
    throw failure(error, "Failed to fetch post");
  }
};

// ------------------------------------------------------------------
// CATEGORIES
// ------------------------------------------------------------------
const listCategories = async (): Promise<ServiceResult<unknown[]>> => {
  try {
    const rows = await Category.findAll({ order: [["name", "ASC"]] });
    return { success: true, status: 200, message: "OK", data: rows.map((c) => c.toJSON()) };
  } catch (error) {
    throw failure(error, "Failed to fetch categories");
  }
};

const createCategory = async (data: CategoryInput, actor: ContentActor | null = null): Promise<ServiceResult> => {
  try {
    const slug = await ensureUniqueSlug(Category, slugify(data.slug || data.name));
    const values = {
      name: data.name,
      description: data.description || null,
      slug,
    };
    // As built: the validated values are written as the caller sent them.
    const cat = await db.transaction(async (transaction: Transaction) => {
      const created = await Category.create(values as CreationAttributes<CategoryRow>, { transaction });
      await auditContent(transaction, actor, "CREATE", "Category", created.id, {
        operation: "CATEGORY_CREATE",
        after: { name: created.name, slug: created.slug },
      });
      return created;
    });
    return { success: true, status: 201, message: "Category created successfully", data: cat.toJSON() };
  } catch (error) {
    throw failure(error, "Failed to create category");
  }
};

const updateCategory = async (id: unknown, data: CategoryInput, actor: ContentActor | null = null): Promise<ServiceResult> => {
  try {
    const cat = await Category.findByPk(id as string);
    if (!cat) {throw new AppError(404, "Category not found");}
    const patch: CategoryPatch = {};
    if (data.name !== undefined) {patch.name = data.name;}
    if (data.description !== undefined) {patch.description = data.description;}
    if (data.slug) {patch.slug = await ensureUniqueSlug(Category, slugify(data.slug), cat.id);}
    // As built: the caller's validated fields are written as sent.
    const before = { name: cat.name, description: cat.description ?? null, slug: cat.slug };
    await db.transaction(async (transaction: Transaction) => {
      await cat.update(patch as Partial<Attributes<CategoryRow>>, { transaction });
      await auditContent(transaction, actor, "UPDATE", "Category", cat.id, {
        operation: "CATEGORY_UPDATE",
        before,
        after: { name: cat.name, description: cat.description ?? null, slug: cat.slug },
      });
    });
    return { success: true, status: 200, message: "Category updated successfully", data: cat.toJSON() };
  } catch (error) {
    throw failure(error, "Failed to update category");
  }
};

const deleteCategory = async (id: unknown, actor: ContentActor | null = null): Promise<ServiceResult> => {
  try {
    const cat = await Category.findByPk(id as string);
    if (!cat) {throw new AppError(404, "Category not found");}
    await db.transaction(async (transaction: Transaction) => {
      await cat.softDelete();
      await auditContent(transaction, actor, "DELETE", "Category", cat.id, {
        operation: "CATEGORY_DELETE",
        before: { name: cat.name, slug: cat.slug },
      });
    });
    return { success: true, status: 200, message: "Category deleted successfully" };
  } catch (error) {
    throw failure(error, "Failed to delete category");
  }
};
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

export = {
  listPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  checkSlug,
  listPublishedPosts,
  getPublishedPostBySlug,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
