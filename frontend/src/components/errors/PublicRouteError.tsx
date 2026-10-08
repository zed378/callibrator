"use client";

import React, { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "@/components/icons/static";
import type { RouteErrorProps } from "./RouteError";

/**
 * F-07 for the public pages (app/(public)/error.tsx). ADR-131 (P10-18): the
 * public root layout loads only the public sheet, so this boundary is drawn
 * with the `--pub-*` tokens inside a public surface. Same behaviour as
 * RouteError: the error's text is never shown, its `digest` is, as a
 * reference; "Try again" re-renders the segment. A separate module so the
 * public pages' boundary chunk carries no dashboard markup.
 *
 * The boundary replaces the page, landmark included: one `<main>`, one `<h1>`.
 */
export function PublicRouteError({ error, reset, homeHref, homeLabel }: RouteErrorProps) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div data-surface="public">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div role="alert" className="mx-auto max-w-lg text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-pub-danger" aria-hidden="true" />
          <h1 className="pub-display pub-display-m text-pub-text">This page failed to load</h1>
          <p className="mt-3 text-pub-muted">
            Something went wrong while showing this page. Nothing you entered has
            been sent. Try again, or go back.
          </p>
          {error.digest && (
            <p className="mt-2 text-sm text-pub-subtle">
              Reference: <code className="pub-mono">{error.digest}</code>
            </p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={reset} className="pub-btn pub-btn-primary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
            <a href={homeHref} className="pub-btn pub-btn-secondary">
              {homeLabel}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
