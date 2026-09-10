// src/app/login/components/SsoLoginForm.tsx
import React from "react";
import { Shield } from "lucide-react";
import Spinner from "@/components/auth/Spinner";

interface SsoLoginFormProps {
  tenantCode: string;
  setTenantCode: (val: string) => void;
  ssoProtocol: "saml" | "oidc";
  setSsoProtocol: (val: "saml" | "oidc") => void;
  onSubmit: (e: React.FormEvent) => void;
  ssoLoading: boolean;
}

export function SsoLoginForm({
  tenantCode,
  setTenantCode,
  ssoProtocol,
  setSsoProtocol,
  onSubmit,
  ssoLoading,
}: SsoLoginFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 animate-fade-in-up delay-200"
    >
      <div>
        <span className="block text-sm font-medium text-foreground mb-2">
          Protocol
        </span>
        <div className="flex gap-2">
          {(["saml", "oidc"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSsoProtocol(p)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 ring-inset transition-colors ${
                ssoProtocol === p
                  ? "bg-primary/10 text-primary ring-primary/40"
                  : "bg-muted text-muted-foreground ring-border hover:text-foreground"
              }`}
            >
              {p === "saml" ? "SAML" : "OIDC"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="tenantCode"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Tenant Code
        </label>
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Shield className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            id="tenantCode"
            type="text"
            value={tenantCode}
            onChange={(e) => setTenantCode(e.target.value)}
            required
            className="w-full pl-11 pr-4 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="e.g. hca-group"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={ssoLoading}
        className="w-full py-3.5 px-4 bg-linear-to-r from-primary to-accent hover:from-primary hover:to-accent text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
      >
        {ssoLoading ? (
          <>
            <Spinner />
            <span>Redirecting to IdP...</span>
          </>
        ) : (
          <span>
            Continue with {ssoProtocol === "oidc" ? "OIDC" : "SAML"}
          </span>
        )}
      </button>
    </form>
  );
};

export default SsoLoginForm;
