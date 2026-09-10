import React from "react";
import { formatDate, type Post } from "@/lib/content.api";

export default function PostMeta({ post, className = "" }: { post: Post; className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground ${className}`}
    >
      {post.authorName && (
        <span className="font-semibold text-foreground">
          {post.authorName}
          {post.authorRole ? (
            <span className="font-normal text-muted-foreground"> · {post.authorRole}</span>
          ) : null}
        </span>
      )}
      {post.authorName && post.publishedAt && <span aria-hidden="true">·</span>}
      {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>}
      {post.readingMinutes ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{post.readingMinutes} min read</span>
        </>
      ) : null}
    </div>
  );
}
