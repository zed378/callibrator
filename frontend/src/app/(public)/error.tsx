"use client";

import { PublicRouteError } from "@/components/errors/PublicRouteError";

/**
 * F-07: the public pages' error boundary. ADR-131 (P10-18): drawn on the public
 * sheet (the public root layout loads no dashboard CSS).
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicRouteError error={error} reset={reset} homeHref="/" homeLabel="Go to the home page" />;
}
