// src/api/services/content.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/content.openapi.ts →
// @callibrator/contracts/content). The exported names are unchanged. The
// media upload stays on `api` (multipart).
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";
import { PaginatedResponse } from "@/types";

type Schemas = components["schemas"];

/** A post on the admin surface (the whole row, with its categories). */
export type Post = Schemas["ContentPost"];
/** A post on the public reads (the marketing site): no status, no body on the list. */
export type PublicPost = Schemas["ContentPublicPost"];
export type PostType = Post["type"];
export type PostStatus = Post["status"];

export type CategoryRef = Schemas["ContentCategoryRef"];
export type Category = Schemas["ContentCategory"];

/** The body without its `null`s: the editor's form state, which never holds one (a subtype of the body). */
type NoNull<T> = { [K in keyof T]: Exclude<T[K], null> };
export type PostInput = NoNull<JsonBody<Op<"/api/v1/content/posts", "post">>>;
export type CategoryInput = NoNull<JsonBody<Op<"/api/v1/content/categories", "post">>>;

export interface PostFilters {
  type?: PostType;
  status?: PostStatus;
  category?: string;
  find?: string;
}

/** A CMS image uploaded to the backend's PUBLIC class (ADR-042 step 3). */
export type ContentMedia = DataOf<Op<"/api/v1/content/media", "post">>;

const byId = (id: string) => ({ params: { path: { id } } });

export const contentService = {
  media: {
    /**
     * POST /api/v1/content/media — upload an image for a post. Unlike an
     * attachment (tenant evidence, gated, revocable), this is public on
     * purpose: it is embedded in published blog/news HTML. JPEG/PNG/GIF/WebP
     * only; SVG is refused. Requires content:create.
     */
    upload: async (file: File): Promise<ContentMedia> => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await api.post<{ data: ContentMedia }>(
        "/api/v1/content/media",
        formData,
      );
      return response.data;
    },
  },

  posts: {
    getAll: async (
      page = 1,
      limit = 20,
      filters: PostFilters = {},
    ): Promise<PaginatedResponse<Post>> => {
      const response = await typedApi
        .GET("/api/v1/content/posts", { params: { query: { page, limit, ...filters } } })
        .then(unwrap);
      // Defensive, as built: a body without a row array or `meta` still renders.
      const rows = Array.isArray(response?.data) ? response.data : [];
      const meta = response?.meta as Schemas["PaginationMeta"] | undefined;
      const total = meta?.total ?? rows.length;
      const lim = meta?.limit ?? limit;
      return {
        success: response?.success ?? true,
        message: response?.message ?? "",
        data: rows,
        meta: {
          total,
          page: meta?.page ?? page,
          limit: lim,
          totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
        },
      };
    },

    get: async (id: string): Promise<Post> =>
      (await typedApi.GET("/api/v1/content/posts/{id}", byId(id)).then(unwrap)).data,

    create: async (data: PostInput): Promise<Post> =>
      (await typedApi.POST("/api/v1/content/posts", { body: data }).then(unwrap)).data,

    update: async (id: string, data: Partial<PostInput>): Promise<Post> =>
      (await typedApi.PATCH("/api/v1/content/posts/{id}", { ...byId(id), body: data }).then(unwrap)).data,

    remove: async (id: string): Promise<void> => {
      await typedApi.DELETE("/api/v1/content/posts/{id}", byId(id));
    },

    checkSlug: async (
      slug: string,
      excludeId?: string,
    ): Promise<DataOf<Op<"/api/v1/content/slug-check", "get">>> =>
      (await typedApi.GET("/api/v1/content/slug-check", { params: { query: { slug, excludeId } } }).then(unwrap))
        .data,
  },

  categories: {
    getAll: async (): Promise<Category[]> => {
      const response = await typedApi.GET("/api/v1/content/categories").then(unwrap);
      // Defensive, as built: anything but an array reads as none.
      return Array.isArray(response?.data) ? response.data : [];
    },

    create: async (data: CategoryInput): Promise<Category> =>
      (await typedApi.POST("/api/v1/content/categories", { body: data }).then(unwrap)).data,

    update: async (id: string, data: Partial<CategoryInput>): Promise<Category> =>
      (await typedApi.PATCH("/api/v1/content/categories/{id}", { ...byId(id), body: data }).then(unwrap)).data,

    remove: async (id: string): Promise<void> => {
      await typedApi.DELETE("/api/v1/content/categories/{id}", byId(id));
    },
  },
};

export default contentService;
