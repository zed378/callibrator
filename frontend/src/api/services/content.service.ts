// src/api/services/content.service.ts
import { api } from "../client";
import { PaginatedResponse } from "@/types";

export type PostType = "BLOG" | "NEWS";
export type PostStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
}

export interface Category extends CategoryRef {
  description?: string | null;
  createdAt?: string;
}

export interface Post {
  id: string;
  type: PostType;
  title: string;
  slug: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  contentHtml?: string | null;
  status: PostStatus;
  publishedAt?: string | null;
  authorName?: string | null;
  authorRole?: string | null;
  authorAvatarUrl?: string | null;
  readingMinutes: number;
  featured: boolean;
  categories?: CategoryRef[];
  createdAt: string;
  updatedAt?: string;
}

export interface PostInput {
  type: PostType;
  title: string;
  slug?: string;
  excerpt?: string;
  coverImageUrl?: string;
  contentHtml?: string;
  status?: PostStatus;
  publishedAt?: string;
  authorName?: string;
  authorRole?: string;
  authorAvatarUrl?: string;
  featured?: boolean;
  categoryIds?: string[];
}

export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string;
}

export interface PostFilters {
  type?: PostType;
  status?: PostStatus;
  category?: string;
  find?: string;
}

interface ListEnvelope<T> {
  success: boolean;
  status: number;
  message: string;
  data: T[] | null;
  meta?: { total: number; page: number; limit: number; totalPages: number };
}

interface ObjEnvelope<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** A CMS image uploaded to the backend's PUBLIC class (ADR-042 step 3). */
export interface ContentMedia {
  /** Host-relative, permanent, public: `/uploads/public/cms/<file>`. */
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

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
      const response = await api.post<ObjEnvelope<ContentMedia>>(
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
      const response = await api.get<ListEnvelope<Post>>("/api/v1/content/posts", {
        params: { page, limit, ...filters },
      });
      const rows = Array.isArray(response?.data) ? response.data : [];
      const meta = response?.meta;
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

    get: async (id: string): Promise<Post> => {
      const response = await api.get<ObjEnvelope<Post>>(`/api/v1/content/posts/${id}`);
      return response.data;
    },

    create: async (data: PostInput): Promise<Post> => {
      const response = await api.post<ObjEnvelope<Post>>("/api/v1/content/posts", data);
      return response.data;
    },

    update: async (id: string, data: Partial<PostInput>): Promise<Post> => {
      const response = await api.patch<ObjEnvelope<Post>>(`/api/v1/content/posts/${id}`, data);
      return response.data;
    },

    remove: async (id: string): Promise<void> => {
      await api.delete(`/api/v1/content/posts/${id}`);
    },

    checkSlug: async (
      slug: string,
      excludeId?: string,
    ): Promise<{ slug: string; available: boolean; suggestion: string }> => {
      const response = await api.get<
        ObjEnvelope<{ slug: string; available: boolean; suggestion: string }>
      >("/api/v1/content/slug-check", { params: { slug, excludeId } });
      return response.data;
    },
  },

  categories: {
    getAll: async (): Promise<Category[]> => {
      const response = await api.get<ListEnvelope<Category>>("/api/v1/content/categories");
      return Array.isArray(response?.data) ? response.data : [];
    },

    create: async (data: CategoryInput): Promise<Category> => {
      const response = await api.post<ObjEnvelope<Category>>("/api/v1/content/categories", data);
      return response.data;
    },

    update: async (id: string, data: Partial<CategoryInput>): Promise<Category> => {
      const response = await api.patch<ObjEnvelope<Category>>(
        `/api/v1/content/categories/${id}`,
        data,
      );
      return response.data;
    },

    remove: async (id: string): Promise<void> => {
      await api.delete(`/api/v1/content/categories/${id}`);
    },
  },
};

export default contentService;
