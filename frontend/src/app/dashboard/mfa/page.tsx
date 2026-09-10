// src/app/dashboard/mfa/page.tsx
"use client";

import React, { useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { ShieldCheck, KeyRound, Copy, Check } from "lucide-react";
import { authService } from "@/api/services/auth.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

type Step = "idle" | "enrolling" | "done";

export default function MfaPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // The backend user may carry an mfaEnabled flag; treat missing as unknown.
  const alreadyEnabled =
    (user as { mfaEnabled?: boolean } | null)?.mfaEnabled === true;

  const beginSetup = async () => {
    setBusy(true);
    try {
      const { secret: s, qrCodeUrl: qr } = await authService.mfaSetup();
      setSecret(s);
      setQrCodeUrl(qr);
      setCode("");
      setStep("enrolling");
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not start MFA setup",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authService.mfaVerify(code.trim());
      addToast({
        type: "success",
        title: "Two-factor authentication enabled",
      });
      setStep("done");
    } catch (err) {
      addToast({
        type: "error",
        title: "Invalid code",
        description:
          err instanceof Error
            ? err.message
            : "The code did not match — try the current one.",
      });
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the secret is visible for manual entry.
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Two-Factor Authentication
          </h1>
          <p className="text-sm text-muted-foreground">
            Add a time-based one-time code from an authenticator app as a second
            factor at sign-in.
          </p>
        </div>

        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <ShieldCheck className="h-6 w-6 shrink-0 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    {user?.email ?? "Your account"}
                  </h2>
                  {(alreadyEnabled || step === "done") && (
                    <Badge variant="success" size="sm">
                      MFA enabled
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step === "done"
                    ? "You'll be asked for a code from your authenticator app the next time you sign in."
                    : "Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy, …), then confirm a code to turn it on."}
                </p>
              </div>
            </div>

            {step === "idle" && (
              <div className="mt-6 border-t border-border pt-4">
                <Button
                  onClick={beginSetup}
                  isLoading={busy}
                  leftIcon={<KeyRound className="h-4 w-4" />}
                >
                  {alreadyEnabled ? "Re-enroll Authenticator" : "Set Up Authenticator"}
                </Button>
              </div>
            )}

            {step === "enrolling" && (
              <div className="mt-6 grid gap-6 border-t border-border pt-6 sm:grid-cols-[auto_1fr]">
                <div className="flex flex-col items-center gap-3">
                  {qrCodeUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- data-URL QR from the backend; no remote host/optimization needed
                    <img
                      src={qrCodeUrl}
                      alt="Authenticator QR code"
                      className="h-44 w-44 rounded-lg bg-white p-2"
                    />
                  )}
                  <div className="w-full">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Or enter this secret manually
                    </p>
                    <button
                      type="button"
                      onClick={copySecret}
                      className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all ring-1 ring-border ring-inset hover:bg-muted/70"
                    >
                      <span className="text-left">{secret}</span>
                      {copied ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </div>

                <form onSubmit={verify} className="space-y-4">
                  <div>
                    <label
                      htmlFor="mfa-enroll-code"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      Enter the 6-digit code
                    </label>
                    <input
                      id="mfa-enroll-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      className="w-full rounded-xl bg-muted px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-foreground ring-1 ring-border ring-inset focus:ring-2 focus:ring-ring/50"
                      placeholder="000000"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" isLoading={busy} disabled={code.length < 6}>
                      Verify &amp; Enable
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep("idle")}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold">Good to know</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>Keep a backup of your authenticator app or its recovery codes.</li>
              <li>
                Once enabled, every sign-in asks for a fresh code after your
                password.
              </li>
              <li>
                Passkeys are an alternative second factor — manage them under
                Passkeys.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
