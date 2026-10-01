/**
 * Content (blog / news) request bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/content.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the content routes.
 */
import { z } from "zod";
import { booleanish, dateLike, nullableText, uuid } from "./fields";

const postBase = {
  type: z.enum(["BLOG", "NEWS"]),
  title: z.string().min(2).max(255),
  slug: nullableText(280),
  excerpt: nullableText(),
  coverImageUrl: nullableText(500),
  contentHtml: nullableText(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  publishedAt: dateLike().nullable().optional(),
  authorName: nullableText(150),
  authorRole: nullableText(150),
  authorAvatarUrl: nullableText(500),
  featured: booleanish().optional(),
  categoryIds: z.array(uuid()).optional(),
};

/** An update must change something. */
const atLeastOneKey = (value: object): boolean => Object.keys(value).length >= 1;
const NOTHING_TO_UPDATE = { error: "Provide at least one field to update" };

const createPost = z.object(postBase);

const updatePost = z
  .object({ ...postBase, type: postBase.type.optional(), title: postBase.title.optional() })
  .refine(atLeastOneKey, NOTHING_TO_UPDATE);

const createCategory = z.object({
  name: z.string().min(1).max(120),
  slug: nullableText(140),
  description: nullableText(),
});

const updateCategory = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(140).optional(),
    description: nullableText(),
  })
  .refine(atLeastOneKey, NOTHING_TO_UPDATE);

export { createPost, updatePost, createCategory, updateCategory };

// The client-side (input) and handler-side (output) types of each schema.
export type CreatePostInput = z.input<typeof createPost>;
export type CreatePostBody = z.output<typeof createPost>;
export type UpdatePostInput = z.input<typeof updatePost>;
export type UpdatePostBody = z.output<typeof updatePost>;
export type CreateCategoryInput = z.input<typeof createCategory>;
export type CreateCategoryBody = z.output<typeof createCategory>;
export type UpdateCategoryInput = z.input<typeof updateCategory>;
export type UpdateCategoryBody = z.output<typeof updateCategory>;
