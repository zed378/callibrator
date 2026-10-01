// P10-13 (ADR-098 §1): the news index on the public surface — the public
// header, footer and tokens; the month-grouped list (19 Part II) is kept.
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import type { Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { ContentShell } from "@/components/public/ContentShell";
import NewsList from "@/components/blog/NewsList";
import { getPublishedPosts } from "@/lib/content.api";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t("content.news.meta.title"),
    description: t("content.news.meta.description"),
    alternates: { canonical: "/news" },
  };
}

async function NewsFeed({ locale, t }: { locale: Locale; t: Translate }) {
  const posts = await getPublishedPosts("NEWS");
  return (
    <div className="mt-12">
      {/* The month groups are h3s under the page's h1 — as on /blog. */}
      <h2 className="sr-only">{t("content.news.listHeading")}</h2>
      <NewsList posts={posts} locale={locale} t={t} />
    </div>
  );
}

export default async function NewsPage() {
  const { locale, t } = await getServerI18n();
  return (
    <ContentShell locale={locale} t={t}>
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-14 sm:px-6 lg:pt-20">
        <header className="max-w-3xl">
          <p className="pub-eyebrow">{t("content.news.eyebrow")}</p>
          <h1 className="pub-display pub-display-l mt-4 text-pub-text">{t("content.news.title")}</h1>
        </header>

        <Suspense fallback={<div className="pub-card mt-12 h-64" aria-hidden="true" />}>
          <NewsFeed locale={locale} t={t} />
        </Suspense>
      </div>
    </ContentShell>
  );
}
