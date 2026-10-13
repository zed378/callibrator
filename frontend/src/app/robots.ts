import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/blog", "/news"],
        // P22-08: /d/ is a sticker's capability page (ADR-138) — never crawled.
        disallow: ["/dashboard", "/api", "/d/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
