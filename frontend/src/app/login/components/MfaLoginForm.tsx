// src/app/login/components/MfaLoginForm.tsx
import React from "react";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import Spinner from "@/components/auth/Spinner";

interface MfaLoginFormProps {
  code: string;
  setCode: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  isLoading: boolean;
}

export function MfaLoginForm({
  code,
  setCode,
  onSubmit,
  onBack,
  isLoading,
}: MfaLoginFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-5 animate-fade-in-up">
      <div className="flex items-center gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
        <span>
          Two-factor authentication is enabled. Enter the 6-digit code from your
          authenticator app.
        </span>
      </div>

      <div>
        <label
          htmlFor="mfa-code"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Authentication code
        </label>
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
      </div>

      <button
        type="submit"
        disabled={isLoading || code.length < 6}
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
