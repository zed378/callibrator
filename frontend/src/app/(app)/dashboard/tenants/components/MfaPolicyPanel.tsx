"use client";

import React, { useEffect, useState } from "react";
import type { Tenant } from "@/types";
import { Alert, Button, Dialog } from "@/components/ui";
import { tenantService } from "@/api/services/tenant.service";
import { useToastStore } from "@/stores/toastStore";

/** The tenant_settings keys (backend utils/mfaPolicy.util.js). */
export const MFA_REQUIRED_KEY = "mfa_required";
export const MFA_REQUIRED_MIN_ROLE_LEVEL_KEY = "mfa_required_min_role_level";

interface MfaPolicyPanelProps {
  tenant: Tenant | null;
  onClose: () => void;
}

const isOn = (value: unknown) => String(value ?? "").trim().toLowerCase() === "true";

/**
 * A-160 — the tenant "MFA required" policy. Read and written through the
 * existing settings API (POST/PATCH /tenants/settings: Management access,
 * audited). While on, a user of this tenant without MFA can use only the MFA
 * page until they enrol. The optional minimum role level narrows it to roles
 * at or above that level; blank means everyone.
 */
export const MfaPolicyPanel: React.FC<MfaPolicyPanelProps> = ({ tenant, onClose }) => {
  const addToast = useToastStore((s) => s.addToast);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [required, setRequired] = useState(false);
  const [minLevel, setMinLevel] = useState("");

  const tenantId = tenant?.id;
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    tenantService
      .getSettings(tenantId)
      .then((res) => {
        if (cancelled) return;
        const settings = res?.settings ?? {};
        setRequired(isOn(settings[MFA_REQUIRED_KEY]));
        setMinLevel(String(settings[MFA_REQUIRED_MIN_ROLE_LEVEL_KEY] ?? ""));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the settings");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!tenant) return null;

  const levelValid = minLevel.trim() === "" || /^\d+$/.test(minLevel.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await tenantService.updateSettings(tenant.id, {
        [MFA_REQUIRED_KEY]: required ? "true" : "false",
        [MFA_REQUIRED_MIN_ROLE_LEVEL_KEY]: minLevel.trim(),
      });
      addToast({
        type: "success",
        title: required ? "MFA is now required" : "MFA is no longer required",
        description: required
          ? "Users without MFA are sent to set it up at their next request."
          : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog isOpen onClose={onClose} title={`MFA policy — ${tenant.name}`} size="md">
      <div className="space-y-5">
        {error && <Alert variant="error">{error}</Alert>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Require two-factor authentication
                </span>
                <span className="block text-sm text-muted-foreground">
                  A user without MFA can use only the MFA page until they set it up. Super
                  admins and impersonation sessions are exempt.
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="mfa-min-level" className="block text-sm font-semibold text-foreground">
                Only for roles at or above level (optional)
              </label>
              <input
                id="mfa-min-level"
                inputMode="numeric"
                disabled={!required}
                value={minLevel}
                onChange={(e) => setMinLevel(e.target.value)}
                placeholder="Everyone"
                className="mt-1 w-full rounded-xl bg-muted px-4 py-2.5 text-foreground ring-1 ring-border ring-inset focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
              />
              {!levelValid && (
                <p className="mt-1 text-sm text-destructive">Enter a whole number, or leave it blank.</p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} isLoading={saving} disabled={!levelValid}>
                Save
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};

export default MfaPolicyPanel;
