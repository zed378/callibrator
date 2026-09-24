"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ApiErrorDetails, describeApiError } from "@/api/client";

/**
 * F-07: what a failed request says to the user, by status — the rules of
 * docs/FRONTEND/08-ERROR-BOUNDARIES.md and CLAUDE.md § Status Codes:
 *
 * - 403: a permission refusal inside the caller's own tenant;
 * - 404: not found — which, by design, includes another tenant's record;
 * - 409: an invalid state transition — the BACKEND's explanation is the
 *   message ("this certificate is in draft and must be submitted first"),
 *   shown in the page, not only in a toast;
 * - 429: rate limited — wait, then retry;
 * - timeout / network: the request never got an answer — retry.
 *
 * `retryable` says whether a Retry button makes sense.
 */
export const errorStateCopy = (
  details: ApiErrorDetails,
): { title: string; message: string; retryable: boolean } => {
  if (details.kind === "network") {
    return {
      title: "You appear to be offline",
      message: "The server could not be reached. Check the connection and retry.",
      retryable: true,
    };
  }
  if (details.kind === "timeout") {
    return {
      title: "The request timed out",
      message: "The server took too long to answer. Retry in a moment.",
      retryable: true,
    };
  }
  switch (details.status) {
    case 403:
      return {
        title: "Access restricted",
        message: details.message || "Your role does not permit this.",
        retryable: false,
      };
    case 404:
      return {
        title: "Not found",
        message: "It does not exist, or it is not available to you.",
        retryable: false,
      };
    case 408:
      return {
        title: "The request timed out",
        message: details.message || "The server gave up on this request. Retry in a moment.",
        retryable: true,
      };
    case 409:
      return {
        title: "This action is not possible right now",
        message: details.message,
        retryable: false,
      };
    case 429:
      return {
        title: "Too many requests",
        message: "Please wait a moment before trying again.",
        retryable: true,
      };
    default:
      return {
        title: "Something went wrong",
        message: details.message || "The request failed.",
        retryable: true,
      };
  }
};

interface ErrorStateProps {
  /** What the request rejected with. */
  error: unknown;
  /** Overrides the status-derived heading. */
  title?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * The failed state of a list or a panel — separate from its empty state,
 * because a failed request must never render as "no data"
 * (docs/FRONTEND/00-FRONTEND-STANDARDS.md § Errors). Carries the backend's
 * X-Request-Id as a reference the user can quote.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  error,
  title,
  onRetry,
  className = "",
}) => {
  const details = describeApiError(error);
  const copy = errorStateCopy(details);
  return (
    <div
      role="alert"
      className={`rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center ${className}`}
    >
      <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" aria-hidden="true" />
      <p className="font-semibold text-foreground">{title ?? copy.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy.message}</p>
      {details.requestId && (
        <p className="mt-2 text-xs text-muted-foreground">
          Reference: <code className="font-mono">{details.requestId}</code>
        </p>
      )}
      {onRetry && copy.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
};

export default ErrorState;
