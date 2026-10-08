// src/app/login/components/IdentifierForm.tsx
//
// P10-04 (doc 20 §7.2): step 1 of the identifier-first sign-in. One field,
// email or username; the server decides the next step by the email's DOMAIN
// (never the account), so the user is never asked for a protocol.
import React, { useState } from "react";
import Spinner from "@/components/auth/Spinner";
import { useI18n } from "@/i18n/MessagesProvider";

interface IdentifierFormProps {
  username: string;
  setUsername: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  errorId?: string;
}

export function IdentifierForm({ username, setUsername, onSubmit, isLoading, errorId }: IdentifierFormProps) {
  const { t } = useI18n();
  // P10-17: a friendly hint on blur, never while the first characters are typed.
  const [touched, setTouched] = useState(false);
  const missing = touched && !username.trim();
  const describedBy = [missing ? "username-hint" : null, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="username" className="pub-label">
          {t("auth.login.identifier")}
        </label>
        <input
          id="username"
          name="username"
          type="text"
          inputMode="email"
          // `webauthn` joins once passwordless passkeys ship (P10-10).
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => setTouched(true)}
          required
          aria-invalid={missing ? true : undefined}
          aria-describedby={describedBy}
          className="pub-input"
        />
        {missing ? (
          <p id="username-hint" className="pub-field-error">
            {t("auth.login.identifierRequired")}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={isLoading || !username.trim()}
        aria-busy={isLoading}
        className="pub-btn pub-btn-primary pub-btn-block"
      >
        {isLoading ? (
          <>
            <Spinner />
            <span>{t("auth.login.busy")}</span>
          </>
        ) : (
          <span>{t("auth.login.continue")}</span>
        )}
      </button>
    </form>
  );
}

export default IdentifierForm;
