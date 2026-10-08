// src/app/login/components/PasswordLoginForm.tsx
//
// P10-04 (doc 20 §7.2–7.3): step 2 of the identifier-first sign-in. The
// identifier chosen in step 1 is shown (and kept in a hidden `username` field
// so password managers pair it); `autocomplete` on every field (SC 1.3.5);
// "Forgot password?" → /forgot-password; the show-password toggle is a real
// button with aria-pressed. "Remember me" is gone: it had no state and sent
// nothing (05 A9, P10-00).
import React, { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "@/components/icons/static";
import Spinner from "@/components/auth/Spinner";
import { useI18n } from "@/i18n/MessagesProvider";

interface PasswordLoginFormProps {
  username: string;
  password: string;
  setPassword: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onChangeAccount: () => void;
  isLoading: boolean;
  showPassword: boolean;
  setShowPassword: (val: boolean) => void;
  /** The error summary's id, so the field can point at it. */
  errorId?: string;
}

export function PasswordLoginForm({
  username,
  password,
  setPassword,
  onSubmit,
  onChangeAccount,
  isLoading,
  showPassword,
  setShowPassword,
  errorId,
}: PasswordLoginFormProps) {
  const { t } = useI18n();
  // P10-17: a friendly hint on blur, never while typing.
  const [touched, setTouched] = useState(false);
  const missing = touched && !password;
  const describedBy = [missing ? "password-hint" : null, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-pub-border bg-pub-raised px-3 py-2.5">
        <span className="min-w-0 truncate text-[0.9375rem] text-pub-text">
          {t("auth.login.signingInAs", { identifier: username })}
        </span>
        <button type="button" onClick={onChangeAccount} className="pub-link text-sm">
          {t("auth.login.changeAccount")}
        </button>
      </div>
      {/* The identifier, for password managers: they pair a password with the username field beside it. */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="pub-label">
            {t("auth.login.password")}
          </label>
          <Link href="/forgot-password" className="pub-link text-sm">
            {t("auth.login.forgot")}
          </Link>
        </div>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            required
            aria-invalid={missing ? true : undefined}
            aria-describedby={describedBy}
            className="pub-input pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-pub-muted hover:text-pub-text"
          >
            {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
        {missing ? (
          <p id="password-hint" className="pub-field-error">
            {t("auth.login.passwordRequired")}
          </p>
        ) : null}
      </div>

      <button type="submit" disabled={isLoading} aria-busy={isLoading} className="pub-btn pub-btn-primary pub-btn-block">
        {isLoading ? (
          <>
            <Spinner />
            <span>{t("auth.login.busy")}</span>
          </>
        ) : (
          <span>{t("auth.login.submit")}</span>
        )}
      </button>
    </form>
  );
}

export default PasswordLoginForm;
