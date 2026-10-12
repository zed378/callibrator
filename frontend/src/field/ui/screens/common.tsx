"use client";
/** P22-10c2 — small parts the field screens share: a screen-change button and a native field's classes. */
import React from "react";
import { go, hrefOf, type View } from "../nav";

/** A native control's classes (theme tokens; touch size). */
export const FIELD_INPUT =
  "w-full min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

/** A link to another field screen: a real `href` (it works without script) that moves by `pushState`. */
export function ScreenLink({ view, id, refId, className, children }: { view: View; id?: string; refId?: string; className?: string; children: React.ReactNode }) {
  const extra = { ...(id ? { id } : {}), ...(refId ? { ref: refId } : {}) };
  return (
    <a
      href={hrefOf(view, extra)}
      onClick={(e) => {
        e.preventDefault();
        go(view, extra);
      }}
      className={className ?? "inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"}
    >
      {children}
    </a>
  );
}

export const HOUR_MS = 3600 * 1000;
/** The working set's life (P19-08 § 10). */
export const WORKING_SET_LIFE_MS = 72 * HOUR_MS;
