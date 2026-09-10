import React, { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import LandingLayout from "@/components/layouts/LandingLayout";
import PostMeta from "@/components/blog/PostMeta";
import ArticleBody from "@/components/blog/ArticleBody";
import ShareRow from "@/components/blog/ShareRow";
import { getPublishedPost } from "@/lib/content.api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post || post.type !== "NEWS") return { title: "News — HDC" };
  return {
    title: `${post.title} — HDC News`,
    description: post.excerpt || undefined,
    alternates: { canonical: `/news/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt || undefined,
      type: "article",
      publishedTime: post.publishedAt || undefined,
      images: post.coverImageUrl ? [post.coverImageUrl] : undefined,
    },
  };
}

async function NewsArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post || post.type !== "NEWS") notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:pt-36">
      <Link
        href="/news"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All news
      </Link>

      {(post.categories ?? []).length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {(post.categories ?? []).map((c) => (
            <span
              key={c.id}
              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
            >
              {c.name}
            </span>
          ))}
        </div>
      )}

      <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-4xl">
        {post.title}
      </h1>
      <PostMeta post={post} className="mt-5" />

      {post.coverImageUrl && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.coverImageUrl} alt={post.title} className="w-full object-cover" />
        </div>
      )}

      <div className="mt-8">
        <ArticleBody html={post.contentHtml || ""} />
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <ShareRow title={post.title} />
      </div>
    </article>
  );
}

export default function NewsDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <LandingLayout>
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-4 pb-24 pt-32">
            <div className="h-96 animate-pulse rounded-2xl bg-muted" />
          </div>
        }
      >
        <NewsArticle params={params} />
      </Suspense>
    </LandingLayout>
  );
}
