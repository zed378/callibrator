// src/app/oauth/consent/page.tsx
"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck, Check, X } from "lucide-react";
import { oidcService, type OidcAuthRequest } from "@/api/services/oidc.service";

const SCOPE_LABELS: Record<string, string> = {
  openid: "Verify your identity",
  profile: "Access your basic profile (name)",
  email: "Access your email address",
  offline_access: "Maintain access when you're offline",
};

function ConsentScreen() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request") ?? "";

  const [request, setRequest] = useState<OidcAuthRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) {
      setError("Missing authorization request.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setRequest(await oidcService.getAuthRequest(requestId));
    } catch {
      setError("This authorization request has expired or is invalid.");
    } finally {
      setIsLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (approve: boolean) => {
    setDeciding(true);
    try {
      const { redirectTo } = await oidcService.submitDecision(requestId, approve);
      // Hand control back to the OAuth client (with the code, or access_denied).
      window.location.href = redirectTo;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not submit your decision.",
      );
      setDeciding(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 rounded-full bg-primary/10 p-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Authorize access
          </h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : request ? (
          <>
            <p className="text-center text-sm text-muted-foreground">
              <strong className="text-foreground">{request.clientName}</strong>{" "}
              wants to access your account. It will be able to:
            </p>

            <ul className="my-6 space-y-2">
              {request.scope.map((s) => (
                <li
                  key={s}
                  className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="text-foreground">
                    {SCOPE_LABELS[s] ?? s}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mb-5 text-center text-xs text-muted-foreground wrap-break-word">
              You&apos;ll be redirected to {request.redirectUri}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={deciding}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
              >
                <X className="h-4 w-4" />
                Deny
              </button>
              <button
                type="button"
                onClick={() => decide(true)}
                disabled={deciding}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-primary to-accent px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {deciding ? "Authorizing…" : "Allow"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function OidcConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <ConsentScreen />
    </Suspense>
  );
}
