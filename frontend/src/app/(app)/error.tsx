"use client";

import { RouteError } from "@/components/errors/RouteError";

/**
 * F-07: the signed-in application's root error boundary (activation, the SSO
 * callback, the OAuth consent screen; the dashboard has its own, which leads
 * back to it). ADR-131 (P10-18): one per root layout, on that group's sheet.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} homeHref="/" homeLabel="Go to the home page" />;
}
