"use client";
// src/app/invitation/components/InvitationForm.tsx
//
// P10-15 (doc 20 §8.2, §11.2): accept the invitation. The token is read from
// `?token=` once and then removed from the address bar (history.replaceState),
// so it stays out of history and any later Referer. The rule is shown before
// typing; an invalid, used or expired token is one generic answer from the
// backend and one sentence here. Success → /login with a status notice.
import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "@/components/icons/static";
import Spinner from "@/components/auth/Spinner";
import { loadAuthService } from "@/components/public/authApi";
import { usePrefetchOnFirstInput } from "@/hooks/usePrefetchOnFirstInput";
import { useI18n } from "@/i18n/MessagesProvider";
import { readApiFailure } from "@/i18n/apiErrors";
import { meetsPasswordRule } from "@/app/(public)/login/components/FirstPasswordChangeForm";

/** A 400 whose body names fields is the password rule; any other 400 is the token. */
const isFieldError = (body: unknown) => {
  const b = body as { errors?: unknown[]; details?: unknown[] };
  return (Array.isArray(b?.errors) && b.errors.length > 0) || (Array.isArray(b?.details) && b.details.length > 0);
};

export function InvitationForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read once, at first render; the address bar is cleaned right after.
  const [token] = useState(() => searchParams.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  // P10-19: the API layer is not in the first load; it arrives with the first
  // key press or tap in the form (and is awaited on submit in any case).
  usePrefetchOnFirstInput(loadAuthService);

  useEffect(() => {
    if (searchParams.has("token")) window.history.replaceState(null, "", window.location.pathname);
  }, [searchParams]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tokenMissing = !token;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetsPasswordRule(password) || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const authService = await loadAuthService();
      await authService.acceptInvitation(token, password);
      router.push("/login?status=invited");
    } catch (err) {
      const failure = readApiFailure(err);
      if (failure.status === 400 && !isFieldError(failure.body)) {
        setExpired(true);
      } else {
        setError(failure.status === 400 ? t("reset.rule") : t("invite.error.generic"));
      }
      setBusy(false);
    }
  };

  if (tokenMissing || expired) {
    return (
      <div>
        <h1 className="pub-display pub-display-m text-pub-text">{t("invite.title")}</h1>
        <div role="alert" className="pub-alert mt-6">
          {t("invite.expired")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="pub-display pub-display-m text-pub-text">{t("invite.title")}</h1>
      <p className="mt-3 text-pub-muted">{t("invite.leadGeneric")}</p>
      {error ? (
        <div role="alert" className="pub-alert mt-6">
          {error}
        </div>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <div>
          <label htmlFor="invite-password" className="pub-label">
            {t("auth.first.newPassword")}
          </label>
          <div className="relative">
            <input
              id="invite-password"
              name="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="invite-rule"
              className="pub-input pr-12"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
              aria-pressed={show}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-pub-muted hover:text-pub-text"
            >
              {show ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
          <p id="invite-rule" className="pub-help">
            {t("reset.rule")}
          </p>
        </div>
        <div>
          <label htmlFor="invite-confirm" className="pub-label">
            {t("auth.first.confirm")}
          </label>
          <input
            id="invite-confirm"
            name="confirm-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? "invite-mismatch" : undefined}
            className="pub-input"
          />
          {mismatch ? (
            <p id="invite-mismatch" className="pub-field-error">
              {t("auth.first.mismatch")}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={busy || !meetsPasswordRule(password) || password !== confirm}
          aria-busy={busy}
          className="pub-btn pub-btn-primary pub-btn-block"
        >
          {busy ? (
            <>
              <Spinner />
              <span>{t("invite.busy")}</span>
            </>
          ) : (
            <span>{t("invite.submit")}</span>
          )}
        </button>
      </form>
    </div>
  );
}

export default InvitationForm;
