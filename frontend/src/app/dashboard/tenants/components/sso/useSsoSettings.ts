import { useState, useEffect } from "react";
import { Tenant } from "@/types";
import { useTenantStore } from "@/stores/tenantStore";
import { parseXmlMetadata } from "./parseXmlMetadata";

export function useSsoSettings(tenant: Tenant | null, onClose: () => void) {
  const { fetchTenantSettings, updateTenantSettings, isLoading, error } = useTenantStore();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"config" | "sp" | "xml">("config");
  const [xmlContent, setXmlContent] = useState("");
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [xmlSuccess, setXmlSuccess] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form state
  const [form, setForm] = useState({
    sso_enabled: false,
    sso_idp_entry_point: "",
    sso_idp_entity_id: "",
    sso_idp_cert: "",
    sso_sp_entity_id: "",
    sso_sp_callback_url: "",
  });

  useEffect(() => {
    if (tenant) {
      const loadSettings = async () => {
        try {
          const res = await fetchTenantSettings(tenant.id);
          const settings = res.settings || {};
          setForm({
            sso_enabled: settings.sso_enabled === "true" || settings.sso_enabled === true,
            sso_idp_entry_point: settings.sso_idp_entry_point || "",
            sso_idp_entity_id: settings.sso_idp_entity_id || "",
            sso_idp_cert: settings.sso_idp_cert || "",
            sso_sp_entity_id: settings.sso_sp_entity_id || "",
            sso_sp_callback_url: settings.sso_sp_callback_url || "",
          });
        } catch (err) {
          console.error("Failed to load tenant settings:", err);
        }
      };
      loadSettings();
      setSaveSuccess(false);
      setXmlSuccess(false);
      setXmlError(null);
      setXmlContent("");
      setActiveTab("config");
    }
  }, [tenant, fetchTenantSettings]);

  const hostUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "http://localhost:3000";
  const backendHostUrl = hostUrl.replace("3000", "5000");

  const defaultSpEntityId = `${backendHostUrl}/api/v1/auth/sso/metadata/${tenant?.code || ""}`;
  const defaultAcsUrl = `${backendHostUrl}/api/v1/auth/sso/callback/${tenant?.code || ""}`;

  const currentSpEntityId = form.sso_sp_entity_id || defaultSpEntityId;
  const currentAcsUrl = form.sso_sp_callback_url || defaultAcsUrl;

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setSaveSuccess(false);
    try {
      await updateTenantSettings(tenant.id, {
        sso_enabled: form.sso_enabled,
        sso_idp_entry_point: form.sso_idp_entry_point,
        sso_idp_entity_id: form.sso_idp_entity_id,
        sso_idp_cert: form.sso_idp_cert,
        sso_sp_entity_id: form.sso_sp_entity_id,
        sso_sp_callback_url: form.sso_sp_callback_url,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  const handleXmlParse = () => {
    setXmlError(null);
    setXmlSuccess(false);
    try {
      const { entityId, entryPoint, cert } = parseXmlMetadata(xmlContent);
      setForm((prev) => ({
        ...prev,
        sso_idp_entity_id: entityId || prev.sso_idp_entity_id,
        sso_idp_entry_point: entryPoint || prev.sso_idp_entry_point,
        sso_idp_cert: cert || prev.sso_idp_cert,
      }));
      setXmlSuccess(true);
      setActiveTab("config");
    } catch (err) {
      setXmlError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleXmlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setXmlContent(text);
      };
      reader.readAsText(file);
    }
  };

  return {
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
  };
}
export default useSsoSettings;
