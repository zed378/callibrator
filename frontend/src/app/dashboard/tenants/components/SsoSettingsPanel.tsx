// src/app/dashboard/tenants/components/SsoSettingsPanel.tsx
"use client";

import React from "react";
import type { Tenant } from "@/types";
import { Alert } from "@/components/ui";
import { Shield, Check, X } from "lucide-react";
import SsoConfigTab from "./sso/SsoConfigTab";
import SsoSpTab from "./sso/SsoSpTab";
import SsoXmlTab from "./sso/SsoXmlTab";
import { useSsoSettings } from "./sso/useSsoSettings";

interface SsoSettingsPanelProps {
  tenant: Tenant | null;
  onClose: () => void;
}

export const SsoSettingsPanel: React.FC<SsoSettingsPanelProps> = ({
  tenant,
  onClose,
}) => {
  const {
    isLoading,
    error,
    copiedField,
    activeTab,
    setActiveTab,
    xmlContent,
    setXmlContent,
    xmlError,
    xmlSuccess,
    saveSuccess,
    form,
    setForm,
    defaultSpEntityId,
    defaultAcsUrl,
    currentSpEntityId,
    currentAcsUrl,
    handleCopy,
    handleSave,
    handleXmlParse,
    handleXmlFileUpload,
  } = useSsoSettings(tenant, onClose);

  if (!tenant) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-background rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center border border-primary/20">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">SSO SAML Configuration</h2>
              <p className="text-xs text-muted-foreground">{tenant.name} ({tenant.code})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-white/5 rounded-xl transition-all duration-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border bg-muted/50 px-6">
          {(["config", "sp", "xml"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-4 text-sm font-semibold transition-all relative ${
                activeTab === tab ? "text-primary" : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              {tab === "config" ? "SAML Settings" : tab === "sp" ? "SP Parameters" : "Import Metadata XML"}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && <Alert variant="error">{error}</Alert>}

          {saveSuccess && (
            <div className="p-4 bg-success/10 border border-success/20 text-success rounded-xl text-sm flex items-center gap-3 animate-fade-in">
              <Check className="w-5 h-5 flex-shrink-0" />
              SAML Configuration saved successfully!
            </div>
          )}

          {xmlSuccess && (
            <div className="p-4 bg-success/10 border border-success/20 text-success rounded-xl text-sm flex items-center gap-3 animate-fade-in">
              <Check className="w-5 h-5 flex-shrink-0" />
              Metadata XML imported successfully!
            </div>
          )}

          {activeTab === "config" && (
            <SsoConfigTab
              form={form}
              onChange={setForm}
              onSubmit={handleSave}
              onClose={onClose}
              isLoading={isLoading}
              defaultSpEntityId={defaultSpEntityId}
              defaultAcsUrl={defaultAcsUrl}
            />
          )}

          {activeTab === "sp" && (
            <SsoSpTab
              currentSpEntityId={currentSpEntityId}
              currentAcsUrl={currentAcsUrl}
              defaultSpEntityId={defaultSpEntityId}
              copiedField={copiedField}
              handleCopy={handleCopy}
            />
          )}

          {activeTab === "xml" && (
            <SsoXmlTab
              xmlContent={xmlContent}
              setXmlContent={setXmlContent}
              xmlError={xmlError}
              handleXmlFileUpload={handleXmlFileUpload}
              handleXmlParse={handleXmlParse}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SsoSettingsPanel;
