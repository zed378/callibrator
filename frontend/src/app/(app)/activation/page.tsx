"use client";

/**
 * A-60 item 3 (ADR-075, Q-11) — where the activation link lands.
 *
 * Registration and an email change (A-180) mail a link to
 * `<origin>/activation?token=…`. Until now no page answered that path, so the
 * link was a 404 and `isEmailVerified` could never become true through the
 * application. Signing in does not wait on it (ADR-051 Q-11, upheld by
 * ADR-075): verification proves the address, which is the password-reset
 * channel. This page spends the token once and says what happened.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, MailCheck } from "lucide-react";
import { authService } from "@/api/services/auth.service";

type Status = "verifying" | "verified" | "error";

function ActivationHandler() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);

  // React's development double-invoke would verify twice; the second call
  // would only say "already activated", but there is no reason to make it.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = searchParams.get("token");
    // The token verifies an address; it has no business in history.
    window.history.replaceState(null, "", window.location.pathname);

    const verify = async () => {
      if (!token) {
        setError("This activation link is incomplete. Open the link from your email again.");
        setStatus("error");
        return;
      }
      try {
        await authService.activateAccount(token);
        setStatus("verified");
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "This activation link could not be used.",
        );
        setStatus("error");
      }
    };

    void verify();
  }, [searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div
        className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-2xl"
        role="status"
        aria-live="polite"
      >
        {status === "verifying" && (
          <>
            <MailCheck className="mx-auto mb-4 h-10 w-10 animate-pulse text-primary" aria-hidden="true" />
            <h1 className="mb-2 text-2xl font-bold text-foreground">Verifying your email address</h1>
            <p className="text-muted-foreground">One moment…</p>
          </>
        )}

        {status === "verified" && (
          <>
            <MailCheck className="mx-auto mb-4 h-10 w-10 text-success" aria-hidden="true" />
            <h1 className="mb-2 text-2xl font-bold text-foreground">Email address verified</h1>
            <p className="mb-8 text-muted-foreground">
              Your address is confirmed. You can sign in, and password resets will be sent to it.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
            >
              Go to sign in
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" aria-hidden="true" />
            <h1 className="mb-2 text-2xl font-bold text-foreground">Verification failed</h1>
            <p className="mb-8 text-sm text-destructive">{error}</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function ActivationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          Loading…
        </div>
      }
    >
      <ActivationHandler />
    </Suspense>
  );
}
