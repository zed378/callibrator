import type { MetadataRoute } from "next";
import { getPublishedPosts } from "@/lib/content.api";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // getPublishedPosts swallows fetch errors → [] (so a build with the backend
  // unreachable still emits the static routes).
  const [blog, news] = await Promise.all([
    getPublishedPosts("BLOG"),
    getPublishedPosts("NEWS"),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/news`, changeFrequency: "weekly", priority: 0.7 },
  ];

  const postRoutes: MetadataRoute.Sitemap = [
    ...blog.map((p) => ({
      url: `${SITE}/blog/${p.slug}`,
      lastModified: p.publishedAt || undefined,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...news.map((p) => ({
      url: `${SITE}/news/${p.slug}`,
      lastModified: p.publishedAt || undefined,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];

  return [...staticRoutes, ...postRoutes];
}
