"use client";

import React, { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Next's re-render attempt of the failed segment. */
  reset: () => void;
  /** Where "go back" leads. */
  homeHref: string;
  homeLabel: string;
}

/**
 * F-07: the body of a route-level error boundary (app/error.tsx,
 * app/dashboard/error.tsx). An uncaught render error used to take the whole
 * route to Next's default page. The message is not shown — a render error's
 * text is for developers — but the `digest` Next attaches (the id of the
 * server-side log entry) is, as a reference to quote.
 */
export function RouteError({ error, reset, homeHref, homeLabel }: RouteErrorProps) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-lg py-16 px-4 text-center">
      <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
      <h1 className="text-xl font-bold text-foreground">This page failed to load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong while showing this page. Nothing you entered has
        been sent. Try again, or go back.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <a
          href={homeHref}
          className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          {homeLabel}
        </a>
      </div>
    </div>
  );
}
