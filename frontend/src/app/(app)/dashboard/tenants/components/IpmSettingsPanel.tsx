"use client";

/**
 * M-18 (P26-01 § 9 C-1) — the tenant administrator's screen for the IPM and public-page settings:
 * the public device page (ADR-138 § 5), the IPSRS's electronic countersignature (UD-17), the IPM
 * interval and the tenant's time zone (P19-02 § 4.3). Read and written through the existing settings
 * API (`POST` / `PATCH /tenants/settings`, `tenantId` in the body; `management` write; audited by the
 * server). The rules and the body are `ipmSettings.ts`.
 *
 * Loading, failed (with a retry) and loaded are three states; a failed read is never shown as
 * "all off". A refusal (400, 403, 409) is the server's explanation, as written.
 */
import React, { useCallback, useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Tenant } from "@/types";
import { Alert, Button, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { tenantService } from "@/api/services/tenant.service";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import { deferEffect } from "@/lib/deferEffect";
import {
  DEFAULT_TIME_ZONE,
  IPM_INTERVAL_MAX,
  IPM_INTERVAL_MIN,
  PUBLIC_DEVICE_PAGE_MODES,
  SUGGESTED_TIME_ZONES,
  changesOf,
  formOf,
  problemsOf,
  type IpmSettingsForm,
} from "./ipmSettings";

interface Props {
  tenant: Tenant;
  onClose: () => void;
}

const FIELD =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary aria-[invalid=true]:border-destructive";

export function IpmSettingsPanel({ tenant, onClose }: Props) {
  const { t } = useI18n();
  const addToast = useToastStore((s) => s.addToast);
  const id = useId();
  const [loaded, setLoaded] = useState<IpmSettingsForm | null>(null);
  const [form, setForm] = useState<IpmSettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [nothing, setNothing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const { settings } = await tenantService.getSettings(tenant.id);
      const f = formOf(settings as Record<string, unknown>);
      setLoaded(f);
      setForm(f);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => deferEffect(load), [load]);

  const update = (patch: Partial<IpmSettingsForm>) => {
    setNothing(false);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  const problems = form ? problemsOf(form) : [];
  const shown = checked ? problems : [];

  const save = async () => {
    if (!form || !loaded) return;
    setChecked(true);
    setError(null);
    if (problems.length) return;
    const changes = changesOf(loaded, form);
    if (Object.keys(changes).length === 0) {
      setNothing(true);
      return;
    }
    setSaving(true);
    try {
      await tenantService.updateSettings(tenant.id, changes);
      addToast({ type: "success", title: t("tenantSettings.saved") });
      onClose();
    } catch (err) {
      setError(describeApiError(err).message || t("tenantSettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const ids = {
    publicPage: `${id}-public`,
    countersign: `${id}-countersign`,
    interval: `${id}-interval`,
    intervalHelp: `${id}-interval-help`,
    intervalError: `${id}-interval-error`,
    timeZone: `${id}-zone`,
    timeZoneHelp: `${id}-zone-help`,
    timeZoneError: `${id}-zone-error`,
    zones: `${id}-zones`,
  };

  return (
    <Dialog isOpen onClose={onClose} title={t("tenantSettings.title", { name: tenant.name })} size="lg">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">{t("tenantSettings.lead")}</p>

        <div role="status" aria-live="polite">
          {loading && !form ? (
            <p className="text-sm text-muted-foreground">{t("tenantSettings.loading")}</p>
          ) : loadFailed ? (
            <Alert variant="error" title={t("tenantSettings.loadFailed")}>
              <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void load()}>
                {t("tenantSettings.retry")}
              </Button>
            </Alert>
          ) : null}
        </div>

        {error && (
          <div role="alert">
            <Alert variant="error" title={t("tenantSettings.saveFailed")}>
              <p>{error}</p>
            </Alert>
          </div>
        )}

        {form && !loadFailed && (
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-foreground">{t("tenantSettings.publicPage.legend")}</legend>
              <p className="text-sm text-muted-foreground">{t("tenantSettings.publicPage.help")}</p>
              {PUBLIC_DEVICE_PAGE_MODES.map((mode) => (
                <label key={mode} className="flex items-start gap-3 rounded-md border border-border p-3">
                  <input
                    type="radio"
                    name={ids.publicPage}
                    value={mode}
                    className="mt-1 h-4 w-4"
                    checked={form.publicPage === mode}
                    onChange={() => update({ publicPage: mode })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{t(`tenantSettings.publicPage.${mode}` as MessageKey)}</span>
                    <span className="block text-sm text-muted-foreground">{t(`tenantSettings.publicPage.${mode}Help` as MessageKey)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-foreground">{t("tenantSettings.countersign.legend")}</legend>
              <label htmlFor={ids.countersign} className="flex items-start gap-3">
                <input
                  id={ids.countersign}
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={form.countersign}
                  onChange={(e) => update({ countersign: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{t("tenantSettings.countersign.label")}</span>
                  <span className="block text-sm text-muted-foreground">{t("tenantSettings.countersign.help")}</span>
                </span>
              </label>
            </fieldset>

            <div>
              <label htmlFor={ids.interval} className="block text-sm font-semibold text-foreground">
                {t("tenantSettings.interval.label")}
              </label>
              <input
                id={ids.interval}
                inputMode="numeric"
                className={FIELD}
                value={form.interval}
                aria-invalid={shown.includes("interval")}
                aria-describedby={shown.includes("interval") ? `${ids.intervalHelp} ${ids.intervalError}` : ids.intervalHelp}
                onChange={(e) => update({ interval: e.target.value })}
              />
              <p id={ids.intervalHelp} className="mt-1 text-sm text-muted-foreground">
                {t("tenantSettings.interval.help", { min: IPM_INTERVAL_MIN, max: IPM_INTERVAL_MAX })}
              </p>
              {shown.includes("interval") && (
                <p id={ids.intervalError} className="mt-1 text-sm text-destructive">
                  {t("tenantSettings.interval.invalid", { min: IPM_INTERVAL_MIN, max: IPM_INTERVAL_MAX })}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={ids.timeZone} className="block text-sm font-semibold text-foreground">
                {t("tenantSettings.timeZone.label")}
              </label>
              <input
                id={ids.timeZone}
                list={ids.zones}
                autoComplete="off"
                spellCheck={false}
                className={FIELD}
                value={form.timeZone}
                placeholder={DEFAULT_TIME_ZONE}
                aria-invalid={shown.includes("timeZone")}
                aria-describedby={shown.includes("timeZone") ? `${ids.timeZoneHelp} ${ids.timeZoneError}` : ids.timeZoneHelp}
                onChange={(e) => update({ timeZone: e.target.value })}
              />
              <datalist id={ids.zones}>
                {SUGGESTED_TIME_ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <p id={ids.timeZoneHelp} className="mt-1 text-sm text-muted-foreground">
                {t("tenantSettings.timeZone.help", { zone: DEFAULT_TIME_ZONE })}
              </p>
              {shown.includes("timeZone") && (
                <p id={ids.timeZoneError} className="mt-1 text-sm text-destructive">
                  {t("tenantSettings.timeZone.invalid")}
                </p>
              )}
            </div>

            {nothing && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("tenantSettings.nothing")}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("tenantSettings.cancel")}
              </Button>
              <Button type="submit" variant="primary" isLoading={saving} disabled={saving}>
                {t("tenantSettings.save")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}

export default IpmSettingsPanel;
