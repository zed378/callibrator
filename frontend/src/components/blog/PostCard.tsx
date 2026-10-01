/**
 * A post in a list (blog index, related posts). P10-13: on the public surface's
 * tokens (ADR-098 §1: blog and news keep their 19 Part II layout and take the
 * public header, footer and tokens). Server component.
 */
import React from "react";
import Link from "next/link";
import { formatDate, type Post } from "@/lib/content.api";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

export default function PostCard({ post, locale, t }: { post: Post; locale: Locale; t: Translate }) {
  const base = post.type === "BLOG" ? "blog" : "news";
  return (
    <Link
      href={`/${base}/${post.slug}`}
      className="group pub-card flex flex-col overflow-hidden transition-colors hover:border-pub-border-strong"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-pub-raised">
        {post.coverImageUrl ? (
          // Host-relative /uploads/public URL (rewritten to the API); plain img avoids next/image config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt={post.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-pub-subtle">
            {t("pub.productName")}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        {(post.categories ?? []).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {(post.categories ?? []).slice(0, 2).map((c) => (
              <span key={c.id} className="pub-chip">
                {c.name}
              </span>
            ))}
          </div>
        )}
        <h3 className="text-lg font-semibold leading-snug text-pub-text group-hover:underline group-hover:underline-offset-4">
          {post.title}
        </h3>
        {post.excerpt && <p className="mt-2 line-clamp-2 text-[0.9375rem] text-pub-muted">{post.excerpt}</p>}
        <p className="mt-auto flex flex-wrap items-center gap-x-2 pt-4 text-sm text-pub-subtle">
          {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, locale)}</time>}
          {post.publishedAt && post.readingMinutes ? <span aria-hidden="true">·</span> : null}
          {post.readingMinutes ? <span>{t("content.readingTime", { minutes: post.readingMinutes })}</span> : null}
        </p>
      </div>
    </Link>
  );
}
