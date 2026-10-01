/**
 * The blog's category links. P10-13: a SERVER component — the page already
 * reads `?category=` from its searchParams, so the active link is a prop and
 * the filter ships no JavaScript (it read `useSearchParams` before).
 */
import React from "react";
import Link from "next/link";

interface Cat {
  name: string;
  slug: string;
}

export default function CategoryFilter({
  categories,
  basePath,
  active = "",
  label,
  allLabel,
}: {
  categories: Cat[];
  basePath: string;
  /** The current `?category=` slug; "" for all. */
  active?: string;
  /** The navigation's accessible name. */
  label: string;
  allLabel: string;
}) {
  const chip = (slug: string, text: string) => {
    const isActive = active === slug;
    const href = slug ? `${basePath}?category=${encodeURIComponent(slug)}` : basePath;
    return (
      <li key={slug || "all"}>
        <Link
          href={href}
          aria-current={isActive ? "page" : undefined}
          className={`inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors ${
            isActive
              ? "border-pub-accent bg-pub-raised text-pub-text"
              : "border-pub-border text-pub-muted hover:border-pub-border-strong hover:text-pub-text"
          }`}
        >
          {text}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {chip("", allLabel)}
        {categories.map((c) => chip(c.slug, c.name))}
      </ul>
    </nav>
  );
}
