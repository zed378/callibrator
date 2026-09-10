"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { Shield, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

function AnimatedBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="orb orb-primary absolute w-[600px] h-[600px] -top-[200px] -right-[200px] animate-orb-float-1"
      />
      <div
        className="orb orb-accent absolute w-[500px] h-[500px] -bottom-[150px] -left-[150px] animate-orb-float-2"
      />
      <div
        className="orb orb-secondary absolute w-[400px] h-[400px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-orb-float-1-reverse"
      />
      <div className="absolute inset-0 bg-grid-pattern opacity-100 dark:opacity-50" />
    </div>
  );
}

function SsoCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithSSOToken, error: authError } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing",
  );

  useEffect(() => {
    const processSso = async () => {
      const token = searchParams.get("token");
      if (!token) {
        setError(
          "SSO Authentication failed: token query parameter is missing.",
        );
        setStatus("error");
        return;
      }

      try {
        await loginWithSSOToken(token);
        setStatus("success");
        router.push("/dashboard");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to process SSO login response.",
        );
        setStatus("error");
      }
    };

    processSso();
  }, [searchParams, loginWithSSOToken, router]);

  const cardBg =
    "bg-white backdrop-blur-xl shadow-xl";

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-linear-to-br from-muted via-info/10 to-primary/10 overflow-hidden p-6">
      <AnimatedBackground />

      <div
        className={`relative z-10 w-full max-w-md p-8 rounded-3xl shadow-2xl text-center animate-scale-in ${cardBg}`}
      >
        {status === "processing" && (
          <div className="flex flex-col items-center py-6">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20">
                <Shield className="w-10 h-10 text-primary animate-pulse" />
              </div>
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-lg -z-10" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              SSO Authentication
            </h2>
            <p className="text-muted-foreground mb-6">
              Verifying secure single sign-on response...
            </p>
            <div className="flex justify-center">
              <svg
                className="animate-spin h-8 w-8 text-primary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center py-6">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center border border-success/20">
                <Shield className="w-10 h-10 text-success" />
              </div>
              <div className="absolute inset-0 bg-success/20 rounded-full blur-lg -z-10" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Success
            </h2>
            <p className="text-muted-foreground">
              Successfully authenticated. Redirecting to dashboard...
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center py-6">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center border border-destructive/20">
                <AlertCircle className="w-10 h-10 text-destructive" />
              </div>
              <div className="absolute inset-0 bg-destructive/20 rounded-full blur-lg -z-10" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Authentication Error
            </h2>
            <p className="text-destructive/90 text-sm mb-8 max-w-sm mx-auto">
              {error || authError || "Unknown authentication error"}
            </p>

            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-linear-to-r from-primary to-accent hover:from-primary hover:to-accent text-primary-foreground font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/30"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Login</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SsoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-muted via-info/10 to-primary/10">
          <div className="text-muted-foreground">
            Loading SSO Callback...
          </div>
        </div>
      }
    >
      <SsoCallbackHandler />
    </Suspense>
  );
}
