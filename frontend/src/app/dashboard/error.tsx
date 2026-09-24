"use client";

import { RouteError } from "@/components/errors/RouteError";

/**
 * F-07: the dashboard's error boundary. A render error in one screen no longer
 * blanks the route; the user can retry the segment or return to the dashboard.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      homeHref="/dashboard"
      homeLabel="Back to the dashboard"
    />
  );
}
