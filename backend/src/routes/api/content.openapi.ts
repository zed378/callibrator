/**
 * P9-18 / P9-25 (ADR-103) — the contract of `content.route.ts`, code-first.
 *
 * The CMS behind the marketing /blog and /news pages. Three reads are public
 * (no `auth`): published posts and the categories. Everything else is the
 * admin surface, behind `auth` and the `content` menu (read, create, update,
 * delete). Content is platform-global, not tenant-owned. Every write is
 * audited in its transaction (P6-11), and a post's body is sanitized rich text
 * (A-298). Request bodies are the contract's own schemas
 * (`@callibrator/contracts/content`). Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";
import {
  createCategory,
  createPost,
  updateCategory,
  updatePost,
} from "../../validators/content.validator";

/** The contract's schemas, by the names the operations use. */
const v = { createCategory, createPost, updateCategory, updatePost };

const timestamp = z.iso.datetime();
const POST = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const content = (action: string) => ({ kind: "dynamicAccess", resource: "content", action }) as const;
const idParams = z.object({ id: z.guid().meta({ description: "The post or category", example: POST }) });

// P9-25 item 11: exact, from the Post / Category models and content.service
// (they were open objects naming a `body` no answer carries — the column is
// `contentHtml` — and a public post's `status` / `updatedAt`, which the public
// reads never select).
const POST_TYPES = ["BLOG", "NEWS"] as const;
const POST_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

/** A category row (`Category.findAll` / create / update, `toJSON()`). */
const Category = z
  .object({
    id: z.guid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    isDeleted: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.nullable().optional(),
  })
  .meta({
    id: "ContentCategory",
    example: {
      id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      name: "Calibration",
      slug: "calibration",
      description: null,
      isDeleted: false,
      createdAt: "2030-01-10T09:00:00.000Z",
      updatedAt: "2030-01-10T09:00:00.000Z",
    },
  });

/** A post's categories, as the join selects them (`CATEGORY_INCLUDE`: id, name, slug). */
const CategoryRef = z.object({ id: z.guid(), name: z.string(), slug: z.string() }).meta({ id: "ContentCategoryRef" });

/** The columns a public read selects (`PUBLIC_LIST_ATTRS`), with the categories. */
const publicPostFields = {
  id: z.guid(),
  type: z.enum(POST_TYPES),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  publishedAt: timestamp.nullable(),
  authorName: z.string().nullable(),
  authorRole: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
  readingMinutes: z.number().int(),
  featured: z.boolean(),
  createdAt: timestamp,
  categories: z.array(CategoryRef),
};

const exampleFields = {
  id: POST,
  type: "BLOG",
  title: "Why calibration intervals matter",
  slug: "why-calibration-intervals-matter",
  excerpt: "A short guide.",
  coverImageUrl: null,
  publishedAt: "2030-01-15T09:00:00.000Z",
  authorName: "Calibration Team",
  authorRole: null,
  authorAvatarUrl: null,
  readingMinutes: 4,
  featured: false,
  createdAt: "2030-01-10T09:00:00.000Z",
  categories: [],
} as const;

/** A post on the public reads: the list omits the body; the read by slug carries it. */
const PublicPost = z
  .object({
    ...publicPostFields,
    contentHtml: z.string().nullable().optional().meta({ description: "Sanitized rich text (A-298); on the read by slug only" }),
  })
  .meta({ id: "ContentPublicPost", example: exampleFields });

/** A post on the admin surface: the whole row (`findPostWithCategories`, `findAndCountAll`). */
const Post = z
  .object({
    ...publicPostFields,
    contentHtml: z.string().nullable().meta({ description: "Sanitized rich text (A-298)" }),
    status: z.enum(POST_STATUSES),
    createdBy: z.guid().nullable(),
    isDeleted: z.boolean(),
    updatedAt: timestamp,
    deletedAt: timestamp.nullable(),
  })
  .meta({
    id: "ContentPost",
    example: {
      ...exampleFields,
      contentHtml: "<p>Calibration intervals decide how long a reading can be trusted.</p>",
      status: "PUBLISHED",
      createdBy: null,
      isDeleted: false,
      updatedAt: "2030-01-15T09:00:00.000Z",
      deletedAt: null,
    },
  });

const listQuery = z.object({
  type: z.enum(["BLOG", "NEWS", "blog", "news"]).optional(),
  category: z.string().optional().meta({ description: "Category slug" }),
  page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ example: 25 }),
});

export default defineRouteDocs({
  router: "api/content.route",
  mount: "/api/v1/content",
  tag: "Content",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/posts/public",
      operationId: "listPublishedPosts",
      summary: "List published posts (public)",
      description: "Unauthenticated: the PUBLISHED blog and news posts for the marketing site.",
      permission: null,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of posts; pagination in the top-level `meta`", list: PublicPost },
    },
    {
      method: "get",
      path: "/posts/public/:slug",
      operationId: "getPublishedPost",
      summary: "Get a published post by slug (public)",
      permission: null,
      audited: false,
      params: z.object({ slug: z.string().meta({ description: "The post's slug", example: "why-calibration-intervals-matter" }) }),
      success: { status: 200, description: "The post", data: PublicPost },
    },
    {
      method: "get",
      path: "/categories/public",
      operationId: "listPublicCategories",
      summary: "List categories (public)",
      permission: null,
      audited: false,
      success: { status: 200, description: "The categories", data: z.array(Category) },
    },
    {
      method: "get",
      path: "/posts",
      operationId: "listPosts",
      summary: "List all posts (admin)",
      permission: content("read"),
      audited: false,
      query: listQuery.extend({
        status: z.string().optional().meta({ example: "DRAFT" }),
        find: z.string().optional().meta({ description: "Text in the title" }),
      }),
      success: { status: 200, description: "A page of posts; pagination in the top-level `meta`", list: Post },
    },
    {
      method: "get",
      path: "/slug-check",
      operationId: "checkContentSlug",
      summary: "Check slug availability (admin)",
      description: "Normalizes a slug and reports whether it is free, with a guaranteed-unique suggestion.",
      permission: content("read"),
      audited: false,
      query: z.object({
        slug: z.string().meta({ description: "Raw slug or title text", example: "Why calibration intervals matter" }),
        excludeId: z.guid().optional().meta({ description: "The post being edited keeps its own slug" }),
      }),
      success: {
        status: 200,
        description: "The availability",
        data: z.object({ slug: z.string(), available: z.boolean(), suggestion: z.string() }),
      },
    },
    {
      method: "post",
      path: "/media",
      operationId: "uploadContentMedia",
      summary: "Upload a CMS image (public by design)",
      description:
        "ADR-042 step 3: a JPEG, PNG, GIF or WebP image (5 MB at most) stored in the PUBLIC upload class for embedding in published posts, with an audit row. SVG is refused. Tenant evidence belongs in /attachments, which is never public.",
      permission: content("create"),
      audited: true,
      bodyMediaType: "multipart/form-data",
      body: z.object({ file: z.string().meta({ format: "binary" }) }),
      success: {
        status: 201,
        description: "The stored image",
        data: z.object({ url: z.string(), fileName: z.string(), mimeType: z.string(), size: z.number().int() }).loose(),
      },
    },
    {
      method: "post",
      path: "/posts",
      operationId: "createPost",
      summary: "Create a post (admin)",
      permission: content("create"),
      audited: true,
      body: v.createPost,
      success: { status: 201, description: "The post", data: Post },
    },
    {
      method: "get",
      path: "/posts/:id",
      operationId: "getPost",
      summary: "Get a post by id (admin)",
      permission: content("read"),
      audited: false,
      params: idParams,
      success: { status: 200, description: "The post", data: Post },
    },
    {
      method: "patch",
      path: "/posts/:id",
      operationId: "updatePost",
      summary: "Update a post (admin)",
      permission: content("update"),
      audited: true,
      params: idParams,
      body: v.updatePost,
      success: { status: 200, description: "The post", data: Post },
    },
    {
      method: "delete",
      path: "/posts/:id",
      operationId: "deletePost",
      summary: "Delete a post (admin)",
      permission: content("delete"),
      audited: true,
      params: idParams,
      success: { status: 200, description: "Deleted", empty: true },
    },
    {
      method: "get",
      path: "/categories",
      operationId: "listCategories",
      summary: "List categories (admin)",
      permission: content("read"),
      audited: false,
      success: { status: 200, description: "The categories", data: z.array(Category) },
    },
    {
      method: "post",
      path: "/categories",
      operationId: "createCategory",
      summary: "Create a category (admin)",
      permission: content("create"),
      audited: true,
      body: v.createCategory,
      success: { status: 201, description: "The category", data: Category },
    },
    {
      method: "patch",
      path: "/categories/:id",
      operationId: "updateCategory",
      summary: "Update a category (admin)",
      permission: content("update"),
      audited: true,
      params: idParams,
      body: v.updateCategory,
      success: { status: 200, description: "The category", data: Category },
    },
    {
      method: "delete",
      path: "/categories/:id",
      operationId: "deleteCategory",
      summary: "Delete a category (admin)",
      permission: content("delete"),
      audited: true,
      params: idParams,
      success: { status: 200, description: "Deleted", empty: true },
    },
  ],
});
