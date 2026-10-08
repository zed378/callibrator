// P10-13 (ADR-098 §1): a blog article on the public surface. The body is the
// stored HTML, sanitized again at render (ArticleBody, A-298); the metadata
// (title, canonical, Open Graph, Twitter card) is unchanged but for the
// product name (Q-43).
import React, { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "@/components/icons/static";
import { getServerI18n } from "@/i18n/server";
import type { Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { ContentShell } from "@/components/public/ContentShell";
import PostMeta from "@/components/blog/PostMeta";
import ArticleBody from "@/components/blog/ArticleBody";
import ShareRow from "@/components/blog/ShareRow";
import RelatedPosts from "@/components/blog/RelatedPosts";
import { getPublishedPost, getPublishedPosts } from "@/lib/content.api";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [{ t }, post] = await Promise.all([getServerI18n(), getPublishedPost(slug)]);
  if (!post || post.type !== "BLOG") return { title: t("content.blog.fallbackTitle") };
  return {
    title: t("content.blog.articleTitle", { title: post.title }),
    description: post.excerpt || undefined,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt || undefined,
      type: "article",
      publishedTime: post.publishedAt || undefined,
      images: post.coverImageUrl ? [post.coverImageUrl] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt || undefined,
    },
  };
}

async function Article({ params, locale, t }: { params: Promise<{ slug: string }>; locale: Locale; t: Translate }) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post || post.type !== "BLOG") notFound();

  const related = (await getPublishedPosts("BLOG")).filter((p) => p.id !== post.id).slice(0, 3);

  return (
    <>
      <article className="mx-auto max-w-3xl px-4 pb-16 pt-12 sm:px-6 lg:pt-16">
        <Link href="/blog" className="pub-link-quiet inline-flex items-center gap-2 text-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("content.blog.back")}
        </Link>

        {(post.categories ?? []).length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {(post.categories ?? []).map((c) => (
              <span key={c.id} className="pub-chip">
                {c.name}
              </span>
            ))}
          </div>
        )}

        <h1 className="pub-display pub-display-l mt-4 text-pub-text">{post.title}</h1>
        <PostMeta post={post} locale={locale} t={t} className="mt-5" />

        {post.coverImageUrl && (
          <div className="pub-frame mt-10">
            {/* eslint-disable-next-line @next/next/no-img-element -- a host-relative /uploads/public CMS image of unknown size */}
            <img src={post.coverImageUrl} alt={post.title} className="w-full object-cover" />
          </div>
        )}

        <div className="mt-10">
          <ArticleBody html={post.contentHtml || ""} />
        </div>

        <div className="mt-12 border-t border-pub-border pt-6">
          <ShareRow
            title={post.title}
            labels={{ copy: t("content.share.copy"), copied: t("content.share.copied"), share: t("content.share.share") }}
          />
        </div>
      </article>

      <section aria-labelledby="blog-contact-title" className="border-t border-pub-border bg-pub-surface/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 id="blog-contact-title" className="pub-display pub-display-m text-pub-text">
            {t("landing.contact.title")}
          </h2>
          <p className="pub-prose mt-4 text-pub-muted">{t("landing.contact.lead")}</p>
          <Link href="/request-access" className="pub-btn pub-btn-primary mt-7">
            {t("landing.hero.ctaRequest")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {related.length > 0 && (
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8">
          <RelatedPosts posts={related} locale={locale} t={t} />
        </div>
      )}
    </>
  );
}

export default async function BlogDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { locale, t } = await getServerI18n();
  return (
    <ContentShell locale={locale} t={t}>
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-4 pb-24 pt-12">
            <div className="pub-card h-96" aria-hidden="true" />
          </div>
        }
      >
        <Article params={params} locale={locale} t={t} />
      </Suspense>
    </ContentShell>
  );
}
