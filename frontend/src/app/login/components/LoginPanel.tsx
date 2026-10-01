"use client";
// src/app/login/components/LoginPanel.tsx
//
// P10-04 (doc 20 §7): the sign-in column. Exactly one <h1> at every width,
// here in the form ("Masuk ke Device Calibrator", or the tenant's name on a
// tenant-pinned build, whose logo — never its colour — shows above it). One
// identifier-first flow replaces the Password/SSO tabs; the user never picks a
// protocol. Errors: one role="alert" summary the fields point at.
import React from "react";
import Link from "next/link";
import { KeyRound } from "@/components/icons/static";
import { BrandLockup } from "@/components/public/BrandLockup";
import { useClientValue } from "@/hooks/useClientValue";
import { passkeySupported } from "@/lib/passkey";
import { PASSKEY_SIGN_IN_ENABLED } from "@/lib/publicFeatures";
import { useAuthBrand } from "@/hooks/useAuthBrand";
import { useI18n } from "@/i18n/MessagesProvider";
import { useLoginForm } from "../hooks/useLoginForm";
import IdentifierForm from "./IdentifierForm";
import PasswordLoginForm from "./PasswordLoginForm";
import SsoLoginForm from "./SsoLoginForm";
import MfaLoginForm from "./MfaLoginForm";
import FirstPasswordChangeForm from "./FirstPasswordChangeForm";

const ERROR_ID = "login-error";

export function LoginPanel() {
  const f = useLoginForm();
  const { t } = useI18n();
  const { name, logoUrl, hasTenant } = useAuthBrand();

  const showPasskey = useClientValue(passkeySupported, false) && PASSKEY_SIGN_IN_ENABLED;

  const title = hasTenant ? t("auth.login.titleTenant", { tenantName: name }) : t("auth.login.title");
  const message = f.step === "sso" ? f.ssoError : f.error;

  return (
    <div>
      <div className={hasTenant ? "mb-8" : "mb-8 lg:hidden"}>
        <BrandLockup name={name} logoUrl={logoUrl} />
      </div>
      <h1 className="pub-display pub-display-m text-pub-text">{title}</h1>

      {f.notice && !message ? (
        <p role="status" className="pub-notice mt-6">
          {f.notice}
        </p>
      ) : null}

      <div className="mt-8" aria-live="polite">
        {message ? (
          <div id={ERROR_ID} role="alert" className="pub-alert mb-6">
            <div>
              <p className="font-semibold">{t("auth.login.errorSummary")}</p>
              <p className="mt-0.5 text-pub-muted">{message}</p>
            </div>
          </div>
        ) : null}
      </div>

      {f.step === "first" ? (
        <FirstPasswordChangeForm
          newPassword={f.newPassword}
          setNewPassword={f.setNewPassword}
          confirmPassword={f.confirmPassword}
          setConfirmPassword={f.setConfirmPassword}
          onSubmit={f.handleFirstPasswordChange}
          onBack={f.cancelFirstPasswordChange}
          isLoading={f.firstChangeLoading}
          error={f.firstChangeError}
        />
      ) : f.step === "mfa" ? (
        <MfaLoginForm
          code={f.mfaCode}
          setCode={f.setMfaCode}
          onSubmit={f.handleMfaSubmit}
          onBack={f.cancelMfa}
          isLoading={f.mfaLoading}
          useRecoveryCode={f.useRecoveryCode}
          setUseRecoveryCode={f.setUseRecoveryCode}
        />
      ) : f.step === "sso" ? (
        <SsoLoginForm
          tenantCode={f.tenantCode}
          setTenantCode={f.setTenantCode}
          onSubmit={f.handleSsoSubmit}
          onBack={() => f.setLoginMethod("password")}
          ssoLoading={f.ssoLoading}
          errorId={message ? ERROR_ID : undefined}
        />
      ) : f.step === "password" ? (
        <PasswordLoginForm
          username={f.username}
          password={f.password}
          setPassword={f.setPassword}
          onSubmit={f.handleSubmit}
          onChangeAccount={f.changeAccount}
          isLoading={f.isLoading}
          showPassword={f.showPassword}
          setShowPassword={f.setShowPassword}
          errorId={message ? ERROR_ID : undefined}
        />
      ) : (
        <>
          <IdentifierForm
            username={f.username}
            setUsername={f.setUsername}
            onSubmit={f.handleIdentifierSubmit}
            isLoading={f.discovering}
            errorId={message ? ERROR_ID : undefined}
          />
          <div className="my-6 flex items-center gap-4 text-sm text-pub-subtle" aria-hidden="true">
            <span className="h-px flex-1 bg-pub-border" />
            {t("auth.login.or")}
            <span className="h-px flex-1 bg-pub-border" />
          </div>
          <div className="flex flex-col gap-3">
            {/* P10-10: rendered only where WebAuthn exists (never on the server). */}
            {showPasskey ? (
              <button
                type="button"
                onClick={f.handlePasskey}
                disabled={f.passkeyLoading}
                aria-busy={f.passkeyLoading}
                className="pub-btn pub-btn-secondary pub-btn-block"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {f.passkeyLoading ? t("auth.login.busy") : t("auth.login.passkey")}
              </button>
            ) : null}
            <button type="button" onClick={() => f.setLoginMethod("sso")} className="pub-btn pub-btn-secondary pub-btn-block">
              {t("auth.login.ssoFallback")}
            </button>
          </div>
        </>
      )}

      {f.step === "identifier" || f.step === "password" ? (
        <p className="mt-10 text-center text-[0.9375rem] text-pub-muted">
          <Link href="/request-access" className="pub-link">
            {t("auth.login.noAccount")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default LoginPanel;
