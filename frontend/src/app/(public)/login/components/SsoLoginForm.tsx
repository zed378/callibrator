// src/app/login/components/SsoLoginForm.tsx
//
// P10-04 (doc 20 §7.2): the organisation-code fallback for tenants without an
// email-domain claim. The user types the code only; the server picks SAML or
// OIDC from the tenant's settings (POST /auth/sso/start) and gives one generic
// refusal for an unknown code, SSO off, or misconfigured (A-292).
import React from "react";
import { ArrowLeft } from "@/components/icons/static";
import Spinner from "@/components/auth/Spinner";
import { useI18n } from "@/i18n/MessagesProvider";

interface SsoLoginFormProps {
  tenantCode: string;
  setTenantCode: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  ssoLoading: boolean;
  errorId?: string;
}

export function SsoLoginForm({ tenantCode, setTenantCode, onSubmit, onBack, ssoLoading, errorId }: SsoLoginFormProps) {
  const { t } = useI18n();
  const describedBy = [errorId, "org-code-help"].filter(Boolean).join(" ");
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="tenantCode" className="pub-label">
          {t("auth.login.orgCode")}
        </label>
        <input
          id="tenantCode"
          name="organization"
          type="text"
          autoComplete="organization"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={tenantCode}
          onChange={(e) => setTenantCode(e.target.value)}
          required
          aria-describedby={describedBy}
          className="pub-input pub-mono"
        />
        <p id="org-code-help" className="pub-help">
          {t("auth.login.orgCodeHelp")}
        </p>
      </div>

      <button
        type="submit"
        disabled={ssoLoading || !tenantCode.trim()}
        aria-busy={ssoLoading}
        className="pub-btn pub-btn-primary pub-btn-block"
      >
        {ssoLoading ? (
          <>
            <Spinner />
            <span>{t("auth.login.ssoRedirecting")}</span>
          </>
        ) : (
          <span>{t("auth.login.ssoContinue")}</span>
        )}
      </button>

      <button type="button" onClick={onBack} className="pub-btn pub-btn-ghost pub-btn-block">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{t("auth.login.ssoBack")}</span>
      </button>
    </form>
  );
}

export default SsoLoginForm;
