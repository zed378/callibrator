import React from "react";
import Link from "next/link";
import { formatDate, type Post } from "@/lib/content.api";

export default function PostCard({ post }: { post: Post }) {
  const base = post.type === "BLOG" ? "blog" : "news";
  return (
    <Link
      href={`/${base}/${post.slug}`}
      data-reveal
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {post.coverImageUrl ? (
          // Host-relative /uploads URL (rewritten to the API); plain img avoids next/image config.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt={post.title}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-primary/10 to-accent/10 text-sm font-semibold text-muted-foreground">
            HDC
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        {(post.categories ?? []).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {(post.categories ?? []).slice(0, 2).map((c) => (
              <span
                key={c.id}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
              >
                {c.name}
              </span>
            ))}
          </div>
        )}
        <h3 className="text-lg font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {post.excerpt}
          </p>
        )}
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>}
          {post.readingMinutes ? <span>· {post.readingMinutes} min read</span> : null}
        </div>
      </div>
    </Link>
  );
}
