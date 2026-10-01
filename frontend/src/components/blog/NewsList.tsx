/** The news, grouped by month. Server component (P10-13: public tokens, the page's language). */
import React from "react";
import Link from "next/link";
import { formatDate, type Post } from "@/lib/content.api";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

// Deterministic month label (fixed input) — safe under cacheComponents.
function monthKey(iso: string | null | undefined, locale: Locale, undated: string): string {
  if (!iso) return undated;
  return new Date(iso).toLocaleDateString(locale === "id" ? "id-ID" : "en-US", { year: "numeric", month: "long" });
}

export default function NewsList({ posts, locale, t }: { posts: Post[]; locale: Locale; t: Translate }) {
  const groups: { key: string; items: Post[] }[] = [];
  for (const p of posts) {
    const k = monthKey(p.publishedAt, locale, t("content.news.undated"));
    let g = groups.find((x) => x.key === k);
    if (!g) {
      g = { key: k, items: [] };
      groups.push(g);
    }
    g.items.push(p);
  }

  if (posts.length === 0) {
    return <div className="pub-card p-12 text-center text-pub-muted">{t("content.news.empty")}</div>;
  }

  return (
    <div className="space-y-12">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="pub-eyebrow mb-4">{g.key}</h3>
          <ul className="divide-y divide-pub-border border-y border-pub-border">
            {g.items.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/news/${p.slug}`}
                  className="group flex flex-col gap-1 py-5 sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <time dateTime={p.publishedAt ?? undefined} className="w-40 shrink-0 text-sm text-pub-subtle">
                    {formatDate(p.publishedAt, locale)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {(p.categories ?? []).slice(0, 1).map((c) => (
                        <span key={c.id} className="pub-chip">
                          {c.name}
                        </span>
                      ))}
                      <h4 className="font-semibold text-pub-text group-hover:underline group-hover:underline-offset-4">
                        {p.title}
                      </h4>
                    </div>
                    {p.excerpt && <p className="mt-1 line-clamp-1 text-[0.9375rem] text-pub-muted">{p.excerpt}</p>}
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
