import React from "react";
import PostCard from "./PostCard";
import type { Post } from "@/lib/content.api";

export default function RelatedPosts({ posts }: { posts: Post[] }) {
  if (!posts.length) return null;
  return (
    <section>
      <h2 className="mb-6 text-xl font-bold tracking-tight text-foreground">Keep reading</h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </section>
  );
}
