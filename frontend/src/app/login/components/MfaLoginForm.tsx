// src/app/login/components/MfaLoginForm.tsx
//
// The second-factor step (A-141 recovery codes). P10-04 (doc 20 §7.3): one
// pasteable field (spaces stripped), the instruction tied to the input with
// aria-describedby, the recovery-code switch always visible; restyled on the
// public surface with dictionary strings.
import React from "react";
import { ArrowLeft, KeyRound } from "@/components/icons/static";
import Spinner from "@/components/auth/Spinner";
import { useI18n } from "@/i18n/MessagesProvider";

interface MfaLoginFormProps {
  code: string;
  setCode: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  isLoading: boolean;
  // A-141: sign in with a one-time recovery code instead of the app's code.
  useRecoveryCode?: boolean;
  setUseRecoveryCode?: (value: boolean) => void;
}

/** A recovery code is 16 base32 characters, shown as XXXX-XXXX-XXXX-XXXX. */
const RECOVERY_CODE_LENGTH = 16;

/** Upper-case, base32 characters only, grouped in fours with hyphens. */
export const formatRecoveryCodeInput = (value: string): string =>
  value
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "")
    .slice(0, RECOVERY_CODE_LENGTH)
    .replace(/(.{4})(?=.)/g, "$1-");

const recoveryCodeComplete = (value: string) => value.replace(/-/g, "").length === RECOVERY_CODE_LENGTH;

export function MfaLoginForm({
  code,
  setCode,
  onSubmit,
  onBack,
  isLoading,
  useRecoveryCode = false,
  setUseRecoveryCode,
}: MfaLoginFormProps) {
  const { t } = useI18n();
  const complete = useRecoveryCode ? recoveryCodeComplete(code) : code.length === 6;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="mfa-code" className="pub-label">
          {useRecoveryCode ? t("auth.mfa.recoveryLabel") : t("auth.mfa.title")}
        </label>
        <p id="mfa-help" className="mb-3 text-[0.875rem] text-pub-muted">
          {useRecoveryCode ? t("auth.mfa.recoveryHelp") : t("auth.mfa.help")}
        </p>
        {useRecoveryCode ? (
          <input
            id="mfa-code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            value={code}
            onChange={(e) => setCode(formatRecoveryCodeInput(e.target.value))}
            required
            aria-describedby="mfa-help"
            className="pub-input pub-mono text-center text-lg tracking-widest"
            placeholder="XXXX-XXXX-XXXX-XXXX"
          />
        ) : (
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            // A pasted "123 456" is accepted: every non-digit is stripped.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            aria-describedby="mfa-help"
            className="pub-input pub-mono text-center text-2xl tracking-[0.5em]"
          />
        )}
      </div>

      <button type="submit" disabled={isLoading || !complete} aria-busy={isLoading} className="pub-btn pub-btn-primary pub-btn-block">
        {isLoading ? (
          <>
            <Spinner />
            <span>{t("auth.mfa.busy")}</span>
          </>
        ) : (
          <span>{t("auth.mfa.submit")}</span>
        )}
      </button>

      {setUseRecoveryCode && (
        <button
          type="button"
          onClick={() => setUseRecoveryCode(!useRecoveryCode)}
          className="pub-link inline-flex w-full items-center justify-center gap-2 py-1 text-sm"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          <span>{useRecoveryCode ? t("auth.mfa.useApp") : t("auth.mfa.recovery")}</span>
        </button>
      )}

      <button type="button" onClick={onBack} className="pub-btn pub-btn-ghost pub-btn-block">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{t("auth.mfa.back")}</span>
      </button>
    </form>
  );
}

export default MfaLoginForm;
