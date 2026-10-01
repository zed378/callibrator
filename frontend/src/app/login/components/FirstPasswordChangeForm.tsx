// src/app/login/components/FirstPasswordChangeForm.tsx
//
// P10-16 (ADR-099): the screen after a one-time password's first sign-in. The
// one-time password is already spent — it will not sign in again — so the
// only way forward is to choose a new password here. No session exists yet;
// the form posts the short-lived password-change token the sign-in returned.
//
// P10-04 (ADR-098): restyled on the public surface; strings from the
// dictionaries (the English set outside a provider, which is what tests see).
import React from "react";
import { ArrowLeft } from "@/components/icons/static";
import Spinner from "@/components/auth/Spinner";
import { useI18n } from "@/i18n/MessagesProvider";

interface FirstPasswordChangeFormProps {
  newPassword: string;
  setNewPassword: (val: string) => void;
  confirmPassword: string;
  setConfirmPassword: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  isLoading: boolean;
  /** Shown in an alert region; never says anything about the account. */
  error: string | null;
}

/** The same rule, checked before the request (the server checks it again). */
export const meetsPasswordRule = (value: string): boolean =>
  value.length >= 8 && value.length <= 100 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);

export function FirstPasswordChangeForm({
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  onSubmit,
  onBack,
  isLoading,
  error,
}: FirstPasswordChangeFormProps) {
  const { t } = useI18n();
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-labelledby="first-password-title" noValidate>
      <div>
        <h2 id="first-password-title" className="text-lg font-semibold text-pub-text">
          {t("auth.first.title")}
        </h2>
        <p className="mt-1 text-[0.9375rem] text-pub-muted">{t("auth.first.lead")}</p>
      </div>

      {error && (
        <div role="alert" className="pub-alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="first-new-password" className="pub-label">
          {t("auth.first.newPassword")}
        </label>
        <input
          id="first-new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          aria-describedby="first-password-rule"
          className="pub-input"
        />
        <p id="first-password-rule" className="pub-help">
          {t("auth.first.rule")}
        </p>
      </div>

      <div>
        <label htmlFor="first-confirm-password" className="pub-label">
          {t("auth.first.confirm")}
        </label>
        <input
          id="first-confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "first-password-mismatch" : undefined}
          className="pub-input"
        />
        {mismatch && (
          <p id="first-password-mismatch" className="pub-field-error">
            {t("auth.first.mismatch")}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || mismatch || !meetsPasswordRule(newPassword) || confirmPassword !== newPassword}
        aria-busy={isLoading}
        className="pub-btn pub-btn-primary pub-btn-block"
      >
        {isLoading ? (
          <>
            <Spinner />
            <span>{t("auth.first.busy")}</span>
          </>
        ) : (
          <span>{t("auth.first.submit")}</span>
        )}
      </button>

      <button type="button" onClick={onBack} className="pub-btn pub-btn-ghost pub-btn-block">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{t("auth.first.back")}</span>
      </button>
    </form>
  );
}

export default FirstPasswordChangeForm;
