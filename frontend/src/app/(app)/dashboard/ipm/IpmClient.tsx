"use client";

/**
 * P22-04 — the IPM history (/dashboard/ipm; F-54 … F-57; P19-02 spec § 7, § 10 as built by P21-03
 * and P21-04). `?deviceId=` narrows it to one device: the device register's "IPM history" action
 * (F-57's device tab).
 *
 * What a caller sees follows the SAME effective permissions the API gates read (ADR-102):
 *  - the list and every visit: `ipm` read. A facility-BOUND reader reads its own facility's visits
 *    (the server scopes them): no facility column or filter;
 *  - correct, and a draft's header / submit / discard: `ipm` write, never the platform operator;
 *  - void: `ipm` write and unbound (the route also requires the tenant administrator role).
 *
 * Loading, empty and failed are three states; a failed read is never an empty history. Bilingual
 * (Indonesian default, English): every string is the `ipm.` namespace (with the catalogue's section
 * and outcome names) the server page hands this island.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Eye, Search, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Card, CardContent, ErrorState, StatusBadge } from "@/components/ui";
import { clientFacilityService, type ClientFacilityOption } from "@/api/services/clientFacility.service";
import { deviceRegisterService } from "@/api/services/deviceRegister.service";
import { ipmHistoryService } from "@/api/services/ipmHistory.service";
import { usePermissions } from "@/hooks/usePermissions";
import { usePaged } from "@/hooks/usePaged";
import { deferEffect } from "@/lib/deferEffect";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import { INITIAL_FILTERS, deviceOf, facilityOf, listQuery, roomOf, stateOf, visitLabel, type Caller, type Filters, type Recommendation, type StatusFilter } from "./history";
import { SessionDialog } from "./components/SessionDialog";
import { FIELD, Field, Pager, useIpmText } from "./components/shared";

const RECOMMENDATIONS: Recommendation[] = ["fit_for_use", "needs_calibration", "not_fit_for_use", "needs_repair"];
const STATUSES: Exclude<StatusFilter, "">[] = ["submitted", "voided", "draft", "discarded"];

interface Props {
  /** `?deviceId=` (validated by the server page), or null for every device. */
  deviceId: string | null;
  languageForm?: React.ReactNode;
}

export function IpmClient({ deviceId, languageForm }: Props) {
  const { locale } = useI18n();
  const { t } = useIpmText();
  const permissions = usePermissions();

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("ipm.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ipm.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!permissions.canRead("ipm")) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("ipm.title")}</h1>
          <p className="text-muted-foreground">{t("ipm.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }

  const caller: Caller = { write: permissions.canWrite("ipm"), bound: permissions.facilityBound, superAdmin: permissions.superAdmin };
  return (
    <DashboardLayout>
      <div lang={locale}>
        <History caller={caller} deviceId={deviceId} canReadDevices={permissions.canRead("calibration")} languageForm={languageForm} />
      </div>
    </DashboardLayout>
  );
}

interface HistoryProps {
  caller: Caller;
  deviceId: string | null;
  canReadDevices: boolean;
  languageForm?: React.ReactNode;
}

function History({ caller, deviceId, canReadDevices, languageForm }: HistoryProps) {
  const text = useIpmText();
  const { t } = text;
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [facilities, setFacilities] = useState<ClientFacilityOption[]>([]);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const fetchPage = useCallback((page: number) => ipmHistoryService.list(listQuery(filters, page, deviceId)), [filters, deviceId]);
  const list = usePaged(fetchPage);
  const { setPage, reload } = list;

  // The facility filter's options (provider staff only): a convenience, not a boundary.
  useEffect(() => {
    if (caller.bound) return undefined;
    return deferEffect(async () => {
      try {
        setFacilities(await clientFacilityService.options());
      } catch {
        setFacilities([]);
      }
    });
  }, [caller.bound]);

  // The narrowed device's name, when the caller may read devices; otherwise a neutral phrase.
  useEffect(() => {
    if (!deviceId || !canReadDevices) return undefined;
    return deferEffect(async () => {
      try {
        setDeviceName((await deviceRegisterService.get(deviceId)).name);
      } catch {
        setDeviceName(null);
      }
    });
  }, [deviceId, canReadDevices]);

  const change = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const showFacility = !caller.bound;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" aria-hidden="true" />
            {t("ipm.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{caller.bound ? t("ipm.leadBound") : t("ipm.lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{languageForm}</div>
      </div>

      {deviceId && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
          <span className="font-medium">{t("ipm.device.chip", { name: deviceName ?? t("ipm.device.selected") })}</span>
          <Link href="/dashboard/ipm" className="text-primary underline underline-offset-2">
            {t("ipm.device.clear")}
          </Link>
        </div>
      )}

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("ipm.filters.heading")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!deviceId && (
              <Field id="ipm-filter-q" label={t("ipm.filters.q")}>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <input id="ipm-filter-q" type="search" className={`${FIELD} pl-9`} value={filters.q} maxLength={100} onChange={(e) => change({ q: e.target.value })} />
                </div>
              </Field>
            )}
            <Field id="ipm-filter-status" label={t("ipm.filters.status")}>
              <select id="ipm-filter-status" className={FIELD} value={filters.status} onChange={(e) => change({ status: e.target.value as StatusFilter })}>
                <option value="">{t("ipm.filters.statusDefault")}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`ipm.status.${s}` as MessageKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="ipm-filter-recommendation" label={t("ipm.filters.recommendation")}>
              <select
                id="ipm-filter-recommendation"
                className={FIELD}
                value={filters.recommendation}
                onChange={(e) => change({ recommendation: e.target.value as Filters["recommendation"] })}
              >
                <option value="">{t("ipm.filters.all")}</option>
                {RECOMMENDATIONS.map((r) => (
                  <option key={r} value={r}>
                    {text.recommendation(r)}
                  </option>
                ))}
              </select>
            </Field>
            {showFacility && !deviceId && facilities.length > 0 && (
              <Field id="ipm-filter-facility" label={t("ipm.filters.facility")}>
                <select id="ipm-filter-facility" className={FIELD} value={filters.clientFacilityId} onChange={(e) => change({ clientFacilityId: e.target.value })}>
                  <option value="">{t("ipm.filters.allFacilities")}</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field id="ipm-filter-from" label={t("ipm.filters.from")}>
              <input id="ipm-filter-from" type="date" className={FIELD} value={filters.from} onChange={(e) => change({ from: e.target.value })} />
            </Field>
            <Field id="ipm-filter-to" label={t("ipm.filters.to")}>
              <input id="ipm-filter-to" type="date" className={FIELD} value={filters.to} onChange={(e) => change({ to: e.target.value })} />
            </Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.effectiveOnly} onChange={(e) => change({ effectiveOnly: e.target.checked })} />
            {t("ipm.filters.effectiveOnly")}
          </label>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="p-0">
          {list.loading && <p className="p-6 text-sm text-muted-foreground">{t("ipm.loading")}</p>}
          {!list.loading && list.error !== null && (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => void reload()} />
            </div>
          )}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-base font-medium">{t("ipm.list.empty")}</p>
              <p className="text-sm">{t("ipm.list.emptyHint")}</p>
            </div>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipm.list.caption")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.performed")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.visit")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.device")}</th>
                    {showFacility && <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.facility")}</th>}
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.room")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.performer")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.recommendation")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipm.col.state")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">{t("ipm.col.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((s) => {
                    const device = deviceOf(s);
                    const state = stateOf(s);
                    const name = device?.name ?? deviceName ?? t("ipm.list.unknownDevice");
                    return (
                      <tr key={s.id} className="border-b border-border last:border-0 align-top">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {text.when(s.performedAt)}
                          {s.capturedOffline && <span className="block text-xs text-muted-foreground">{t("ipm.list.offline")}</span>}
                        </td>
                        <td className="px-3 py-2 font-mono">{visitLabel(s.visitNumber) ?? "—"}</td>
                        <td className="px-3 py-2">
                          {device ? (
                            <>
                              <span className="font-semibold text-foreground">{device.name}</span>
                              {device.qrCode && <span className="block font-mono text-xs text-muted-foreground">{device.qrCode}</span>}
                            </>
                          ) : (
                            <span className="text-muted-foreground">{deviceName ?? t("ipm.list.draftDevice")}</span>
                          )}
                        </td>
                        {showFacility && <td className="px-3 py-2">{facilityOf(s) ?? "—"}</td>}
                        <td className="px-3 py-2">{roomOf(s) ?? "—"}</td>
                        <td className="px-3 py-2">{s.performerDisplay?.redacted ? t("ipm.redacted") : (s.performerDisplay?.name ?? "—")}</td>
                        <td className="px-3 py-2">
                          {s.recommendation ? (
                            <StatusBadge domain="ipmRecommendation" state={s.recommendation} size="sm">
                              {text.recommendation(s.recommendation)}
                            </StatusBadge>
                          ) : (
                            <span className="text-muted-foreground">{text.recommendation(null)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge domain="ipmSession" state={state} size="sm">
                            {text.state(state)}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("ipm.action.view", { name, date: text.day(s.performedAt) })}
                            onClick={() => setOpened(s.id)}
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={list.meta} onPage={setPage} label={t("ipm.list.caption")} />
        </CardContent>
      </Card>

      {opened && (
        <SessionDialog
          key={opened}
          sessionId={opened}
          caller={caller}
          onClose={(changed) => {
            setOpened(null);
            if (changed) void reload();
          }}
        />
      )}
    </div>
  );
}
