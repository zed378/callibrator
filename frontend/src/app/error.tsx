"use client";

import { RouteError } from "@/components/errors/RouteError";

/** F-07: the app-wide error boundary. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} homeHref="/" homeLabel="Go to the home page" />;
}
