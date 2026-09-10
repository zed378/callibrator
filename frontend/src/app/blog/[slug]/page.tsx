import React, { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import LandingLayout from "@/components/layouts/LandingLayout";
import PostMeta from "@/components/blog/PostMeta";
import ArticleBody from "@/components/blog/ArticleBody";
import ShareRow from "@/components/blog/ShareRow";
import RelatedPosts from "@/components/blog/RelatedPosts";
import { getPublishedPost, getPublishedPosts } from "@/lib/content.api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post || post.type !== "BLOG") return { title: "Article — HDC" };
  return {
    title: `${post.title} — HDC`,
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

async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post || post.type !== "BLOG") notFound();

  const related = (await getPublishedPosts("BLOG"))
    .filter((p) => p.id !== post.id)
    .slice(0, 3);

  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:pt-36">
      <Link
        href="/blog"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All articles
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

      <h1 className="mt-4 text-balance text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
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

      <div className="mt-16 rounded-2xl bg-linear-to-r from-primary to-accent p-8 text-center text-primary-foreground">
        <h2 className="text-2xl font-bold tracking-tight">Make your next audit the boring one.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-primary-foreground/80">
          Bring every device, schedule, and certificate into one place.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition-transform hover:-translate-y-0.5"
        >
          Start free trial <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {related.length > 0 && (
        <div className="mt-16">
          <RelatedPosts posts={related} />
        </div>
      )}
    </article>
  );
}

export default function BlogDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <LandingLayout>
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-4 pb-24 pt-32">
            <div className="h-96 animate-pulse rounded-2xl bg-muted" />
          </div>
        }
      >
        <Article params={params} />
      </Suspense>
    </LandingLayout>
  );
}
