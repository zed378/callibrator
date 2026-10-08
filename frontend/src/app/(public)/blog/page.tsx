// P10-13 (ADR-098 §1, doc 20 §15): the blog index on the public surface — the
// public header, footer and tokens, every chrome string from the dictionaries.
// The 19 Part II layout (featured post, category links, card grid) is kept.
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import type { Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { ContentShell } from "@/components/public/ContentShell";
import PostCard from "@/components/blog/PostCard";
import CategoryFilter from "@/components/blog/CategoryFilter";
import { getPublishedPosts, getPublicCategories } from "@/lib/content.api";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t("content.blog.meta.title"),
    description: t("content.blog.meta.description"),
    alternates: { canonical: "/blog" },
  };
}

async function BlogIndex({
  searchParams,
  locale,
  t,
}: {
  searchParams: Promise<{ category?: string }>;
  locale: Locale;
  t: Translate;
}) {
  const { category } = await searchParams;
  const [posts, categories] = await Promise.all([getPublishedPosts("BLOG", category), getPublicCategories()]);

  const featured = !category ? (posts.find((p) => p.featured) ?? null) : null;
  const rest = featured ? posts.filter((p) => p.id !== featured.id) : posts;

  return (
    <div className="mt-12 space-y-10">
      <h2 className="sr-only">{t("content.blog.listHeading")}</h2>
      {categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          basePath="/blog"
          active={category ?? ""}
          label={t("content.blog.categories")}
          allLabel={t("content.blog.all")}
        />
      )}

      {featured && <PostCard post={featured} locale={locale} t={t} />}

      {rest.length === 0 ? (
        <div className="pub-card p-12 text-center text-pub-muted">{t("content.blog.empty")}</div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <PostCard key={p.id} post={p} locale={locale} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { locale, t } = await getServerI18n();
  return (
    <ContentShell locale={locale} t={t}>
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <header className="max-w-3xl">
          <p className="pub-eyebrow">{t("content.blog.eyebrow")}</p>
          <h1 className="pub-display pub-display-l mt-4 text-pub-text">{t("content.blog.title")}</h1>
          <p className="pub-body-l pub-prose mt-5 text-pub-muted">{t("content.blog.lead")}</p>
        </header>

        <Suspense fallback={<div className="pub-card mt-12 h-64" aria-hidden="true" />}>
          <BlogIndex searchParams={searchParams} locale={locale} t={t} />
        </Suspense>
      </div>
    </ContentShell>
  );
}
