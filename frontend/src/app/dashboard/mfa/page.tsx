// src/app/dashboard/mfa/page.tsx
"use client";

import React, { useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import {
  ShieldCheck,
  ShieldOff,
  KeyRound,
  Copy,
  Check,
  Download,
  AlertTriangle,
} from "lucide-react";
import { authService } from "@/api/services/auth.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

// "codes": the one-time recovery codes are on screen (A-141). They are never
// retrievable again, so the page stays on them until the user confirms.
type Step = "idle" | "enrolling" | "codes" | "done";

/** Fewer than this many recovery codes left → suggest re-enrolling. */
const LOW_RECOVERY_CODES = 3;

const inputClass =
  "w-full rounded-xl bg-muted px-4 py-2.5 text-foreground ring-1 ring-border ring-inset focus:ring-2 focus:ring-ring/50";

/** Keep the store's user in step without re-fetching (which would unmount the page). */
const patchUser = (patch: {
  mfaEnabled: boolean;
  mfaRecoveryCodesRemaining: number;
  // A-160: enrolling satisfies the tenant's "MFA required" policy.
  mfaEnrolmentRequired?: boolean;
}) =>
  useAuthStore.setState((s) => ({ user: s.user ? { ...s.user, ...patch } : s.user }));

export default function MfaPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [code, setCode] = useState("");
  // A-114: re-authentication for replacing an authenticator that is already on.
  const [currentPassword, setCurrentPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // A-141: the recovery codes, held only while they are shown.
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);
  // A-141: turning MFA off.
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableWithRecovery, setDisableWithRecovery] = useState(false);

  const alreadyEnabled = user?.mfaEnabled === true;
  const codesLeft = user?.mfaRecoveryCodesRemaining;

  const beginSetup = async () => {
    setBusy(true);
    try {
      const { secret: s, qrCodeUrl: qr } = await authService.mfaSetup(
        alreadyEnabled
          ? { currentPassword, code: currentCode.trim() }
          : undefined,
      );
      setSecret(s);
      setQrCodeUrl(qr);
      setCode("");
      setCurrentPassword("");
      setCurrentCode("");
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
      const { recoveryCodes: issued } = await authService.mfaVerify(code.trim());
      addToast({
        type: "success",
        title: alreadyEnabled
          ? "Authenticator replaced — your other sessions were signed out"
          : "Two-factor authentication enabled",
      });
      setSecret("");
      setQrCodeUrl("");
      setRecoveryCodes(issued);
      setCodesSaved(false);
      patchUser({
        mfaEnabled: true,
        mfaRecoveryCodesRemaining: issued.length,
        mfaEnrolmentRequired: false,
      });
      setStep(issued.length > 0 ? "codes" : "done");
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

  const recoveryCodesText = () =>
    [
      `Recovery codes for ${user?.email ?? "your account"}`,
      "Each code works once, in place of an authenticator code.",
      "",
      ...recoveryCodes,
      "",
    ].join("\n");

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodesText());
      setCodesCopied(true);
      setTimeout(() => setCodesCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the codes are on screen and downloadable.
    }
  };

  const downloadCodes = () => {
    const blob = new Blob([recoveryCodesText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const finishCodes = () => {
    // Drop them from memory: they are never shown again.
    setRecoveryCodes([]);
    setStep("done");
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authService.mfaDisable(
        disableWithRecovery
          ? { currentPassword: disablePassword, recoveryCode: disableCode.trim() }
          : { currentPassword: disablePassword, code: disableCode.trim() },
      );
      addToast({
        type: "success",
        title: "Two-factor authentication turned off",
        description: "Your other sessions were signed out.",
      });
      patchUser({ mfaEnabled: false, mfaRecoveryCodesRemaining: 0 });
      setDisabling(false);
      setDisablePassword("");
      setDisableCode("");
      setDisableWithRecovery(false);
      setStep("idle");
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not turn off MFA",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const disableCodeComplete = disableWithRecovery
    ? disableCode.replace(/[\s-]/g, "").length === 16
    : disableCode.length === 6;

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

        {/* A-160: the tenant requires MFA; everything else is refused until
            this account enrols. */}
        {user?.mfaEnrolmentRequired === true && !alreadyEnabled && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              Your organisation requires two-factor authentication. Set it up
              below to continue using the application.
            </p>
          </div>
        )}

        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <ShieldCheck className="h-6 w-6 shrink-0 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    {user?.email ?? "Your account"}
                  </h2>
                  {alreadyEnabled && (
                    <Badge variant="success" size="sm">
                      MFA enabled
                    </Badge>
                  )}
                  {alreadyEnabled &&
                    typeof codesLeft === "number" &&
                    step !== "codes" && (
                      <Badge
                        variant={codesLeft < LOW_RECOVERY_CODES ? "warning" : "default"}
                        size="sm"
                      >
                        {codesLeft} recovery {codesLeft === 1 ? "code" : "codes"} left
                      </Badge>
                    )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step === "done"
                    ? "You'll be asked for a code from your authenticator app the next time you sign in."
                    : "Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy, …), then confirm a code to turn it on."}
                </p>
                {alreadyEnabled &&
                  typeof codesLeft === "number" &&
                  codesLeft < LOW_RECOVERY_CODES &&
                  step === "idle" && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-warning">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      You are running out of recovery codes. Re-enrol your
                      authenticator to get a new set.
                    </p>
                  )}
              </div>
            </div>

            {step === "idle" && (
              <div className="mt-6 space-y-4 border-t border-border pt-4">
                {alreadyEnabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      To replace your authenticator, confirm your password and a
                      code from the authenticator you use now. It keeps working
                      until the new one is verified; then your other sessions
                      are signed out and you get a new set of recovery codes.
                    </p>
                    <div>
                      <label
                        htmlFor="mfa-current-password"
                        className="mb-1.5 block text-sm font-medium"
                      >
                        Current password
                      </label>
                      <input
                        id="mfa-current-password"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="mfa-current-code"
                        className="mb-1.5 block text-sm font-medium"
                      >
                        Current 6-digit code
                      </label>
                      <input
                        id="mfa-current-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={currentCode}
                        onChange={(e) =>
                          setCurrentCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        className={`${inputClass} font-mono tracking-[0.3em]`}
                        placeholder="000000"
                      />
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={beginSetup}
                    isLoading={busy && !disabling}
                    disabled={
                      alreadyEnabled && (!currentPassword || currentCode.length < 6)
                    }
                    leftIcon={<KeyRound className="h-4 w-4" />}
                  >
                    {alreadyEnabled ? "Re-enroll Authenticator" : "Set Up Authenticator"}
                  </Button>
                  {alreadyEnabled && !disabling && (
                    <Button
                      variant="outline"
                      onClick={() => setDisabling(true)}
                      leftIcon={<ShieldOff className="h-4 w-4" />}
                    >
                      Turn Off MFA
                    </Button>
                  )}
                </div>

                {alreadyEnabled && disabling && (
                  <form
                    onSubmit={disable}
                    className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                    aria-label="Turn off two-factor authentication"
                  >
                    <p className="text-sm text-foreground">
                      Turning MFA off removes your authenticator and your
                      recovery codes, and signs out your other sessions. Confirm
                      your password and a code from your authenticator — or, if
                      you no longer have it, one of your recovery codes.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="mfa-disable-password"
                          className="mb-1.5 block text-sm font-medium"
                        >
                          Current password
                        </label>
                        <input
                          id="mfa-disable-password"
                          type="password"
                          autoComplete="current-password"
                          value={disablePassword}
                          onChange={(e) => setDisablePassword(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="mfa-disable-code"
                          className="mb-1.5 block text-sm font-medium"
                        >
                          {disableWithRecovery ? "Recovery code" : "Current 6-digit code"}
                        </label>
                        <input
                          id="mfa-disable-code"
                          type="text"
                          inputMode={disableWithRecovery ? "text" : "numeric"}
                          autoComplete={disableWithRecovery ? "off" : "one-time-code"}
                          value={disableCode}
                          onChange={(e) =>
                            setDisableCode(
                              disableWithRecovery
                                ? e.target.value.toUpperCase().slice(0, 19)
                                : e.target.value.replace(/\D/g, "").slice(0, 6),
                            )
                          }
                          className={`${inputClass} font-mono tracking-widest`}
                          placeholder={disableWithRecovery ? "XXXX-XXXX-XXXX-XXXX" : "000000"}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-sm text-primary hover:text-primary/80"
                      onClick={() => {
                        setDisableWithRecovery(!disableWithRecovery);
                        setDisableCode("");
                      }}
                    >
                      {disableWithRecovery
                        ? "Use a code from my authenticator instead"
                        : "Lost your authenticator? Use a recovery code"}
                    </button>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="danger"
                        isLoading={busy && disabling}
                        disabled={!disablePassword || !disableCodeComplete}
                        leftIcon={<ShieldOff className="h-4 w-4" />}
                      >
                        Turn Off MFA
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setDisabling(false);
                          setDisablePassword("");
                          setDisableCode("");
                          setDisableWithRecovery(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
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

            {step === "codes" && (
              <div className="mt-6 space-y-4 border-t border-border pt-6">
                <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold text-foreground">
                      Save your recovery codes now
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      If you lose your authenticator, each of these codes signs
                      you in once in place of a 6-digit code. They are shown
                      only this once — we keep no copy we can show you again.
                      Store them somewhere safe, away from your phone.
                    </p>
                  </div>
                </div>
                <ul
                  aria-label="Recovery codes"
                  className="grid grid-cols-1 gap-2 rounded-xl bg-muted p-4 font-mono text-sm sm:grid-cols-2"
                >
                  {recoveryCodes.map((c) => (
                    <li key={c} className="tracking-wider text-foreground">
                      {c}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={copyCodes}
                    leftIcon={
                      codesCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />
                    }
                  >
                    {codesCopied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={downloadCodes}
                    leftIcon={<Download className="h-4 w-4" />}
                  >
                    Download
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={codesSaved}
                    onChange={(e) => setCodesSaved(e.target.checked)}
                  />
                  I have saved these recovery codes
                </label>
                <Button onClick={finishCodes} disabled={!codesSaved}>
                  Done
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold">Good to know</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                Keep your recovery codes somewhere safe. Each works once; when
                they run low, re-enrol to get a new set.
              </li>
              <li>
                Lost your authenticator and your codes? A tenant administrator
                can reset your MFA; you then set it up again.
              </li>
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
