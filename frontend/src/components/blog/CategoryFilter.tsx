"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface Cat {
  name: string;
  slug: string;
}

export default function CategoryFilter({
  categories,
  basePath,
}: {
  categories: Cat[];
  basePath: string;
}) {
  const searchParams = useSearchParams();
  const active = searchParams.get("category") || "";

  const chip = (slug: string, label: string) => {
    const isActive = active === slug;
    const href = slug ? `${basePath}?category=${slug}` : basePath;
    return (
      <Link
        key={slug || "all"}
        href={href}
        className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      {chip("", "All")}
      {categories.map((c) => chip(c.slug, c.name))}
    </div>
  );
}
