import React, { Suspense } from "react";
import type { Metadata } from "next";
import LandingLayout from "@/components/layouts/LandingLayout";
import { Eyebrow } from "@/components/landing/_shared/Eyebrow";
import { SectionHeading } from "@/components/landing/_shared/SectionHeading";
import NewsList from "@/components/blog/NewsList";
import { getPublishedPosts } from "@/lib/content.api";

export const metadata: Metadata = {
  title: "News — HDC",
  description: "Product updates, releases, and company news from HDC.",
};

async function NewsFeed() {
  const posts = await getPublishedPosts("NEWS");
  return (
    <div className="mt-10">
      <NewsList posts={posts} />
    </div>
  );
}

export default function NewsPage() {
  return (
    <LandingLayout>
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-32 sm:px-6 lg:pt-36">
        <header className="max-w-2xl">
          <Eyebrow>News</Eyebrow>
          <SectionHeading className="mt-5">
            Product updates, releases, and company news.
          </SectionHeading>
        </header>

        <Suspense fallback={<div className="mt-12 h-64 animate-pulse rounded-2xl bg-muted" />}>
          <NewsFeed />
        </Suspense>
      </div>
    </LandingLayout>
  );
}
