// src/app/dashboard/tenants/components/sso/SsoSpTab.tsx
import React from "react";
import { Check, Copy } from "lucide-react";

interface SsoSpTabProps {
  currentSpEntityId: string;
  currentAcsUrl: string;
  defaultSpEntityId: string;
  copiedField: string | null;
  handleCopy: (text: string, fieldName: string) => void;
}

export const SsoSpTab: React.FC<SsoSpTabProps> = ({
  currentSpEntityId,
  currentAcsUrl,
  defaultSpEntityId,
  copiedField,
  handleCopy,
}) => {
  return (
    <div className="space-y-5">
      <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl text-xs text-muted-foreground space-y-1">
        <span className="font-semibold text-white block mb-1">Service Provider Integration Parameters</span>
        Copy these parameters and paste them in your Identity Provider (e.g. Okta, Azure AD, OneLogin) configuration panel.
      </div>

      {/* SP Entity ID */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-muted-foreground">Entity ID / Audience URI</label>
          <button
            onClick={() => handleCopy(currentSpEntityId, "entity")}
            className="text-primary hover:text-primary text-xs flex items-center gap-1 transition-all"
          >
            {copiedField === "entity" ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy
              </>
            )}
          </button>
        </div>
        <div className="bg-muted/50 rounded-xl px-4 py-3.5 font-mono text-xs text-muted-foreground select-all overflow-x-auto ring-1 ring-border">
          {currentSpEntityId}
        </div>
      </div>

      {/* ACS URL */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-muted-foreground">Assertion Consumer Service (ACS) / Single Sign-On URL</label>
          <button
            onClick={() => handleCopy(currentAcsUrl, "acs")}
            className="text-primary hover:text-primary text-xs flex items-center gap-1 transition-all"
          >
            {copiedField === "acs" ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy
              </>
            )}
          </button>
        </div>
        <div className="bg-muted/50 rounded-xl px-4 py-3.5 font-mono text-xs text-muted-foreground select-all overflow-x-auto ring-1 ring-border">
          {currentAcsUrl}
        </div>
      </div>

      {/* Metadata URL */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-muted-foreground">SP Metadata XML URL</label>
          <button
            onClick={() => handleCopy(defaultSpEntityId, "metadata")}
            className="text-primary hover:text-primary text-xs flex items-center gap-1 transition-all"
          >
            {copiedField === "metadata" ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy
              </>
            )}
          </button>
        </div>
        <div className="bg-muted/50 rounded-xl px-4 py-3.5 font-mono text-xs text-muted-foreground select-all overflow-x-auto ring-1 ring-border">
          {defaultSpEntityId}
        </div>
      </div>
    </div>
  );
};

export default SsoSpTab;
