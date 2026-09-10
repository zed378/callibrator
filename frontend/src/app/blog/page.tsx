import React, { Suspense } from "react";
import type { Metadata } from "next";
import LandingLayout from "@/components/layouts/LandingLayout";
import { Eyebrow } from "@/components/landing/_shared/Eyebrow";
import { SectionHeading } from "@/components/landing/_shared/SectionHeading";
import PostCard from "@/components/blog/PostCard";
import CategoryFilter from "@/components/blog/CategoryFilter";
import { getPublishedPosts, getPublicCategories } from "@/lib/content.api";

export const metadata: Metadata = {
  title: "Blog — HDC",
  description:
    "Field notes on calibration, compliance, and keeping a hospital audit-ready — from the HDC team.",
};

async function BlogIndex({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const [posts, categories] = await Promise.all([
    getPublishedPosts("BLOG", category),
    getPublicCategories(),
  ]);

  const featured = !category ? posts.find((p) => p.featured) ?? null : null;
  const rest = featured ? posts.filter((p) => p.id !== featured.id) : posts;

  return (
    <div className="mt-10 space-y-10">
      {categories.length > 0 && <CategoryFilter categories={categories} basePath="/blog" />}

      {featured && (
        <PostCard post={featured} />
      )}

      {rest.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground">
          No articles here yet — check back soon.
        </div>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  return (
    <LandingLayout>
      <div className="mx-auto max-w-7xl px-4 pb-24 pt-32 sm:px-6 lg:px-8 lg:pt-36">
        <header className="max-w-2xl">
          <Eyebrow>Blog</Eyebrow>
          <SectionHeading className="mt-5">
            Field notes on calibration, compliance, and staying audit-ready.
          </SectionHeading>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Practical writing for the biomedical and quality teams who keep hospital instruments
            honest.
          </p>
        </header>

        <Suspense
          fallback={<div className="mt-12 h-64 animate-pulse rounded-2xl bg-muted" />}
        >
          <BlogIndex searchParams={searchParams} />
        </Suspense>
      </div>
    </LandingLayout>
  );
}
