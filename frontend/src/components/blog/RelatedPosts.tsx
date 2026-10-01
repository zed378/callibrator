import React from "react";
import PostCard from "./PostCard";
import type { Post } from "@/lib/content.api";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

export default function RelatedPosts({ posts, locale, t }: { posts: Post[]; locale: Locale; t: Translate }) {
  if (!posts.length) return null;
  return (
    <section aria-labelledby="related-title">
      <h2 id="related-title" className="pub-display pub-display-m text-pub-text">
        {t("content.blog.related")}
      </h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} locale={locale} t={t} />
        ))}
      </div>
    </section>
  );
}
