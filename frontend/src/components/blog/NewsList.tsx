import React from "react";
import Link from "next/link";
import { formatDate, type Post } from "@/lib/content.api";

// Deterministic month label (fixed input) — safe under cacheComponents.
function monthKey(iso?: string | null): string {
  if (!iso) return "Undated";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

export default function NewsList({ posts }: { posts: Post[] }) {
  const groups: { key: string; items: Post[] }[] = [];
  for (const p of posts) {
    const k = monthKey(p.publishedAt);
    let g = groups.find((x) => x.key === k);
    if (!g) {
      g = { key: k, items: [] };
      groups.push(g);
    }
    g.items.push(p);
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground">
        No news yet — check back soon.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {g.key}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {g.items.map((p) => (
              <li key={p.id} data-reveal>
                <Link
                  href={`/news/${p.slug}`}
                  className="group flex flex-col gap-1 px-6 py-5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <time
                    dateTime={p.publishedAt ?? undefined}
                    className="w-32 shrink-0 text-sm text-muted-foreground"
                  >
                    {formatDate(p.publishedAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {(p.categories ?? []).slice(0, 1).map((c) => (
                        <span
                          key={c.id}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                        >
                          {c.name}
                        </span>
                      ))}
                      <h4 className="font-semibold text-foreground transition-colors group-hover:text-primary">
                        {p.title}
                      </h4>
                    </div>
                    {p.excerpt && (
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{p.excerpt}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
