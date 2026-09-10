// Server-side data access for the public Blog & News pages.
//
// Per the Next 16 docs, Server Components should fetch the backend DIRECTLY
// (not through the /api/v1 proxy route — that fails during build). These
// helpers are called from Server Components; the fetching component is wrapped
// in <Suspense> at the page level so `cacheComponents` streams it at request
// time. (Future optimization: add `use cache` + cacheTag('posts') here and
// revalidateTag on publish.)

import { cacheLife, cacheTag } from "next/cache";
import { API_BASE_URL } from "@/constants";
import type { Post, Category } from "@/api/services/content.service";

export type { Post, Category };

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? null) as T;
  } catch {
    return null;
  }
}

export async function getPublishedPosts(
  type?: "BLOG" | "NEWS",
  category?: string,
): Promise<Post[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("content");
  const p = new URLSearchParams({ limit: "100" });
  if (type) p.set("type", type);
  if (category) p.set("category", category);
  const data = await fetchJson<Post[]>(`/content/posts/public?${p.toString()}`);
  return Array.isArray(data) ? data : [];
}

export async function getPublishedPost(slug: string): Promise<Post | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("content");
  return fetchJson<Post>(`/content/posts/public/${encodeURIComponent(slug)}`);
}

export async function getPublicCategories(): Promise<Category[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("content");
  const data = await fetchJson<Category[]>(`/content/categories/public`);
  return Array.isArray(data) ? data : [];
}

// Deterministic date formatting (fixed input + locale) — safe under
// cacheComponents (unlike a bare `new Date()`).
export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
