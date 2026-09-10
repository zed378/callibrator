// src/app/dashboard/tenants/components/sso/SsoConfigTab.tsx
import React from "react";
import { Button } from "@/components/ui";
import { Save, RefreshCw } from "lucide-react";

interface SsoConfigTabProps {
  form: {
    sso_enabled: boolean;
    sso_idp_entry_point: string;
    sso_idp_entity_id: string;
    sso_idp_cert: string;
    sso_sp_entity_id: string;
    sso_sp_callback_url: string;
  };
  onChange: React.Dispatch<
    React.SetStateAction<{
      sso_enabled: boolean;
      sso_idp_entry_point: string;
      sso_idp_entity_id: string;
      sso_idp_cert: string;
      sso_sp_entity_id: string;
      sso_sp_callback_url: string;
    }>
  >;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  isLoading: boolean;
  defaultSpEntityId: string;
  defaultAcsUrl: string;
}

export const SsoConfigTab: React.FC<SsoConfigTabProps> = ({
  form,
  onChange,
  onSubmit,
  onClose,
  isLoading,
  defaultSpEntityId,
  defaultAcsUrl,
}) => {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* SSO Enabled Toggle */}
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-2xl shadow-sm">
        <div>
          <h4 className="font-semibold text-white">Enable SAML Single Sign-On</h4>
          <p className="text-xs text-muted-foreground">Allow users to log in using Enterprise credentials</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={form.sso_enabled}
            onChange={(e) => onChange({ ...form, sso_enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-white/10 rounded-full peer peer-focus:ring-2 peer-focus:ring-ring/50 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      {/* IdP Entry Point */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-muted-foreground block">Identity Provider SSO URL (Entry Point)</label>
        <input
          type="url"
          value={form.sso_idp_entry_point}
          onChange={(e) => onChange({ ...form, sso_idp_entry_point: e.target.value })}
          placeholder="https://example.okta.com/app/saml/..."
          className="w-full bg-muted/50 rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all text-sm ring-1 ring-border"
        />
      </div>

      {/* IdP Entity ID */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-muted-foreground block">Identity Provider Issuer (Entity ID)</label>
        <input
          type="text"
          value={form.sso_idp_entity_id}
          onChange={(e) => onChange({ ...form, sso_idp_entity_id: e.target.value })}
          placeholder="http://www.okta.com/..."
          className="w-full bg-muted/50 rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all text-sm ring-1 ring-border"
        />
      </div>

      {/* IdP Cert */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-muted-foreground block">Identity Provider Public Certificate (PEM)</label>
        <textarea
          value={form.sso_idp_cert}
          onChange={(e) => onChange({ ...form, sso_idp_cert: e.target.value })}
          rows={4}
          placeholder="-----BEGIN CERTIFICATE-----\nMIIFCzCCAvOgAwIBAgIJAI...\n-----END CERTIFICATE-----"
          className="w-full bg-muted/50 rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all text-xs font-mono ring-1 ring-border"
        />
      </div>

      {/* Advanced Custom SP Settings (Optional toggle) */}
      <details className="group bg-muted/50 rounded-2xl p-4 shadow-sm">
        <summary className="text-sm font-semibold text-muted-foreground cursor-pointer list-none flex items-center justify-between">
          <span>Advanced Service Provider Overrides (Optional)</span>
          <span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground block">Override SP Entity ID</label>
            <input
              type="text"
              value={form.sso_sp_entity_id}
              onChange={(e) => onChange({ ...form, sso_sp_entity_id: e.target.value })}
              placeholder={defaultSpEntityId}
              className="w-full bg-muted/50 rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all text-sm ring-1 ring-border"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground block">Override ACS Callback URL</label>
            <input
              type="url"
              value={form.sso_sp_callback_url}
              onChange={(e) => onChange({ ...form, sso_sp_callback_url: e.target.value })}
              placeholder={defaultAcsUrl}
              className="w-full bg-muted/50 rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all text-sm ring-1 ring-border"
            />
          </div>
        </div>
      </details>

      {/* Submit Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button variant="ghost" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={isLoading}
          leftIcon={isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        >
          Save Configuration
        </Button>
      </div>
    </form>
  );
};

export default SsoConfigTab;
