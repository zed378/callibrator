/** Author, date and reading time under a post's title. Server component (P10-13: public tokens). */
import React from "react";
import { formatDate, type Post } from "@/lib/content.api";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

export default function PostMeta({
  post,
  locale,
  t,
  className = "",
}: {
  post: Post;
  locale: Locale;
  t: Translate;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-pub-muted ${className}`}>
      {post.authorName && (
        <span className="font-semibold text-pub-text">
          {post.authorName}
          {post.authorRole ? <span className="font-normal text-pub-muted"> · {post.authorRole}</span> : null}
        </span>
      )}
      {post.authorName && post.publishedAt && <span aria-hidden="true">·</span>}
      {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, locale)}</time>}
      {post.readingMinutes ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{t("content.readingTime", { minutes: post.readingMinutes })}</span>
        </>
      ) : null}
    </div>
  );
}
