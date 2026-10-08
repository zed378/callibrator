"use client";
// src/app/forgot-password/components/ForgotPasswordForm.tsx
//
// P10-09 (doc 20 §9): the emailed 6-digit OTP reset the backend has always
// had (POST /auth/send-otp, then POST /auth/reset-password). Step 1 always
// answers the same sentence, whether or not the address is registered (the
// controller's reply is neutral, auth.controller.js). Step 2 never says whether
// the code or the email was wrong. A 429's Retry-After drives the resend
// cooldown. Success returns to /login with a status notice.
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "@/components/icons/static";
import Spinner from "@/components/auth/Spinner";
import { loadAuthService } from "@/components/public/authApi";
import { usePrefetchOnFirstInput } from "@/hooks/usePrefetchOnFirstInput";
import { useI18n } from "@/i18n/MessagesProvider";
import { minutesFrom, readApiFailure } from "@/i18n/apiErrors";
import { meetsPasswordRule } from "@/app/(public)/login/components/FirstPasswordChangeForm";

/** Seconds before "resend" is offered when no Retry-After was given. */
export const DEFAULT_RESEND_SECONDS = 60;

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // P10-19: the API layer is not in the first load; it arrives with the first
  // key press or tap in the form (the email field autofocuses, so not on focus).
  usePrefetchOnFirstInput(loadAuthService);

  // The resend cooldown ticks down once a second while it is running.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const send = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const authService = await loadAuthService();
      await authService.sendOtp(email.trim());
      setCooldown(DEFAULT_RESEND_SECONDS);
      return true;
    } catch (err) {
      const failure = readApiFailure(err);
      if (failure.status === 429) {
        // The budget tripped: the answer stays neutral; only the wait is shown.
        setCooldown(failure.retryAfterSeconds ?? DEFAULT_RESEND_SECONDS);
        setError(t("reset.error.rateLimited", { minutes: minutesFrom(failure.retryAfterSeconds) }));
        return false;
      }
      if (failure.status === null) {
        setError(t("reset.error.network"));
        return false;
      }
      // Any other answer is treated as sent: the page must not tell a known
      // address from an unknown one.
      setCooldown(DEFAULT_RESEND_SECONDS);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const onSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    if (await send()) {
      setStep("reset");
      requestAnimationFrame(() => headingRef.current?.focus());
    }
  };

  const onResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetsPasswordRule(password)) {
      setError(t("reset.error.rule"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const authService = await loadAuthService();
      await authService.resetPassword(email.trim(), otp, password);
      router.push("/login?status=reset");
    } catch (err) {
      const failure = readApiFailure(err);
      setError(
        failure.status === 429
          ? t("reset.error.rateLimited", { minutes: minutesFrom(failure.retryAfterSeconds) })
          : failure.status === null
            ? t("reset.error.network")
            : failure.status === 400 || failure.status === 401 || failure.status === 404
              ? t("reset.error.invalid")
              : t("reset.error.generic"),
      );
      setBusy(false);
    }
  };

  const errorBox = error ? (
    <div id="reset-error" role="alert" className="pub-alert mt-6">
      {error}
    </div>
  ) : null;

  if (step === "email") {
    return (
      <div>
        <h1 className="pub-display pub-display-m text-pub-text">{t("reset.title")}</h1>
        <p className="mt-3 text-pub-muted">{t("reset.lead")}</p>
        {errorBox}
        <form onSubmit={onSendSubmit} noValidate className="mt-8 space-y-5">
          <div>
            <label htmlFor="reset-email" className="pub-label">
              {t("reset.email")}
            </label>
            <input
              id="reset-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={error ? "reset-error" : undefined}
              className="pub-input"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !email.trim() || cooldown > 0}
            aria-busy={busy}
            className="pub-btn pub-btn-primary pub-btn-block"
          >
            {busy ? (
              <>
                <Spinner />
                <span>{t("reset.sending")}</span>
              </>
            ) : cooldown > 0 ? (
              <span>{t("reset.resend", { seconds: cooldown })}</span>
            ) : (
              <span>{t("reset.send")}</span>
            )}
          </button>
        </form>
        <p className="mt-8 text-center text-[0.9375rem]">
          <Link href="/login" className="pub-link inline-flex min-h-11 items-center">
            {t("reset.backToLogin")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="pub-display pub-display-m text-pub-text outline-none">
        {t("reset.title")}
      </h1>
      <p role="status" className="pub-notice mt-6">
        {t("reset.sent")}
      </p>
      {errorBox}
      <form onSubmit={onResetSubmit} noValidate className="mt-8 space-y-5">
        <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
        <div>
          <label htmlFor="reset-otp" className="pub-label">
            {t("reset.code")}
          </label>
          <input
            id="reset-otp"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="pub-input auth-otp"
          />
        </div>
        <div>
          <label htmlFor="reset-password" className="pub-label">
            {t("reset.newPassword")}
          </label>
          <div className="relative">
            <input
              id="reset-password"
              name="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="reset-rule"
              className="pub-input pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={t("auth.login.showPassword")}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-pub-muted hover:text-pub-text"
            >
              {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
          <p id="reset-rule" className="pub-help">
            {t("reset.rule")}
          </p>
        </div>
        <button
          type="submit"
          disabled={busy || otp.length !== 6 || !password}
          aria-busy={busy}
          className="pub-btn pub-btn-primary pub-btn-block"
        >
          {busy ? (
            <>
              <Spinner />
              <span>{t("reset.busy")}</span>
            </>
          ) : (
            <span>{t("reset.submit")}</span>
          )}
        </button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-3 text-[0.9375rem]">
        <button type="button" onClick={() => void send()} disabled={busy || cooldown > 0} className="pub-link disabled:no-underline disabled:opacity-70">
          {cooldown > 0 ? t("reset.resend", { seconds: cooldown }) : t("reset.resendNow")}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setOtp("");
            setPassword("");
            setError(null);
          }}
          className="pub-link-quiet"
        >
          {t("reset.changeEmail")}
        </button>
      </div>
    </div>
  );
}

export default ForgotPasswordForm;
