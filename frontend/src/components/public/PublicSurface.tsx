/**
 * P10-01 (ADR-098 §3): the wrapper every public page renders inside. It applies
 * the dark `--pub-*` token set (`data-surface="public"`, public-surface.css)
 * and attaches the two public faces. The dashboard never renders it, so its
 * ADR-090 tokens and fonts are untouched.
 *
 * Server component: no client JavaScript.
 */
import React from "react";
import { publicBodyFont, publicDisplayFont, publicDisplayItalicFont } from "@/app/fonts/public";

export function PublicSurface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-surface="public" className={`${publicDisplayFont.variable} ${publicDisplayItalicFont.variable} ${publicBodyFont.variable} ${className}`}>
      {children}
    </div>
  );
}

export default PublicSurface;
