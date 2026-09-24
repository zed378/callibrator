// src/app/login/components/MfaLoginForm.tsx
import React from "react";
import { ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import Spinner from "@/components/auth/Spinner";

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

const recoveryCodeComplete = (value: string) =>
  value.replace(/-/g, "").length === RECOVERY_CODE_LENGTH;

export function MfaLoginForm({
  code,
  setCode,
  onSubmit,
  onBack,
  isLoading,
  useRecoveryCode = false,
  setUseRecoveryCode,
}: MfaLoginFormProps) {
  const complete = useRecoveryCode ? recoveryCodeComplete(code) : code.length === 6;

  return (
    <form onSubmit={onSubmit} className="space-y-5 animate-fade-in-up">
      <div className="flex items-center gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
        <span>
          {useRecoveryCode
            ? "Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once."
            : "Two-factor authentication is enabled. Enter the 6-digit code from your authenticator app."}
        </span>
      </div>

      <div>
        <label
          htmlFor="mfa-code"
          className="block text-sm font-medium text-foreground mb-2"
        >
          {useRecoveryCode ? "Recovery code" : "Authentication code"}
        </label>
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
            className="w-full px-4 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-center text-lg font-mono tracking-widest text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:tracking-normal placeholder:text-base placeholder:text-muted-foreground"
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
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            className="w-full px-4 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-center text-2xl font-mono tracking-[0.5em] text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:tracking-normal placeholder:text-base placeholder:text-muted-foreground"
            placeholder="000000"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || !complete}
        className="w-full py-3.5 px-4 bg-linear-to-r from-primary to-accent text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Spinner />
            <span>Verifying...</span>
          </>
        ) : (
          <span>Verify &amp; Sign In</span>
        )}
      </button>

      {setUseRecoveryCode && (
        <button
          type="button"
          onClick={() => setUseRecoveryCode(!useRecoveryCode)}
          className="inline-flex w-full items-center justify-center gap-2 text-sm text-primary transition-colors hover:text-primary/80"
        >
          <KeyRound className="w-4 h-4" />
          <span>
            {useRecoveryCode
              ? "Use a code from my authenticator app"
              : "Lost your authenticator? Use a recovery code"}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onBack}
        className="group inline-flex w-full items-center justify-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span>Back to sign in</span>
      </button>
    </form>
  );
}

export default MfaLoginForm;
