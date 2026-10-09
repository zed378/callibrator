"use client";

/**
 * P22-05 — the calibration list (F-63; P19-05 spec § 8, as built by P21-06): by default one row per
 * device, its latest effective record ("latest per device"); every record when that is switched off.
 * Filters: the QR sticker (normalised by the server; a sticker out of view is an empty page), the
 * entry kind, a day range on the calibration or the input date (days of the tenant's zone), and — for
 * provider staff only — the client facility (a convenience; a facility-bound reader's read is already
 * its facility's). The room is the one confirmed at entry (the snapshot), never the device's current
 * room. Loading, empty and failed are three states; a failed read is never an empty list.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, ErrorState, StatusBadge } from "@/components/ui";
import { usePaged } from "@/hooks/usePaged";
import { deferEffect } from "@/lib/deferEffect";
import { calibrationDatesService, type CalibrationRecord, type RecordQuery } from "@/api/services/calibrationDates.service";
import { clientFacilityService, type ClientFacilityOption } from "@/api/services/clientFacility.service";
import { FIELD, Pager, useDatesText } from "./shared";

const PAGE_SIZE = 50;
type KindFilter = "all" | NonNullable<RecordQuery["entryKind"]>;
type DateField = NonNullable<RecordQuery["dateField"]>;

export interface ListFilters {
  qr: string;
  facilityId: string;
  kind: KindFilter;
  dateField: DateField;
  fromDay: string;
  toDay: string;
  latestOnly: boolean;
}

export const INITIAL_FILTERS: ListFilters = { qr: "", facilityId: "", kind: "all", dateField: "calibration", fromDay: "", toDay: "", latestOnly: true };

/** The read's query for a page: only what is set is sent. */
export const listQuery = (f: ListFilters, page: number): RecordQuery => ({
  page,
  limit: PAGE_SIZE,
  latestOnly: f.latestOnly,
  sort: f.dateField === "created" ? "createdAt" : "calibrationDate",
  ...(f.qr.trim() ? { qrCode: f.qr.trim() } : {}),
  ...(f.facilityId ? { clientFacilityId: f.facilityId } : {}),
  ...(f.kind !== "all" ? { entryKind: f.kind } : {}),
  ...(f.fromDay || f.toDay ? { dateField: f.dateField } : {}),
  ...(f.fromDay ? { fromDay: f.fromDay } : {}),
  ...(f.toDay ? { toDay: f.toDay } : {}),
});

export function CalibrationListPanel({ showFacility }: { showFacility: boolean }) {
  const text = useDatesText();
  const { t } = text;
  const [filters, setFilters] = useState<ListFilters>(INITIAL_FILTERS);
  const [facilities, setFacilities] = useState<ClientFacilityOption[]>([]);

  const fetchPage = useCallback((page: number) => calibrationDatesService.listRecords(listQuery(filters, page)), [filters]);
  const list = usePaged(fetchPage);
  const { setPage } = list;

  // The facility filter's options (provider staff only). A failed read leaves the filter out: the
  // list itself still reads every facility the caller may see.
  useEffect(() => {
    if (!showFacility) return undefined;
    return deferEffect(async () => {
      try {
        setFacilities(await clientFacilityService.options());
      } catch {
        setFacilities([]);
      }
    });
  }, [showFacility]);

  const change = (patch: Partial<ListFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const rangeInvalid = filters.fromDay !== "" && filters.toDay !== "" && filters.fromDay > filters.toDay;

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("calibrationDates.list.heading")}</h2>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("calibrationDates.list.lead")}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="list-qr" className="block text-sm font-semibold">
                {t("calibrationDates.list.qr")}
              </label>
              <input id="list-qr" className={`${FIELD} font-mono uppercase`} value={filters.qr} maxLength={64} onChange={(e) => change({ qr: e.target.value })} />
            </div>
            {showFacility && facilities.length > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="list-facility" className="block text-sm font-semibold">
                  {t("calibrationDates.list.facility")}
                </label>
                <select id="list-facility" className={FIELD} value={filters.facilityId} onChange={(e) => change({ facilityId: e.target.value })}>
                  <option value="">{t("calibrationDates.list.allFacilities")}</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="list-kind" className="block text-sm font-semibold">
                {t("calibrationDates.list.kind")}
              </label>
              <select id="list-kind" className={FIELD} value={filters.kind} onChange={(e) => change({ kind: e.target.value as KindFilter })}>
                <option value="all">{t("calibrationDates.list.allKinds")}</option>
                <option value="external_date">{text.kind("external_date")}</option>
                <option value="full_record">{text.kind("full_record")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="list-date-field" className="block text-sm font-semibold">
                {t("calibrationDates.list.dateField")}
              </label>
              <select id="list-date-field" className={FIELD} value={filters.dateField} onChange={(e) => change({ dateField: e.target.value as DateField })}>
                <option value="calibration">{t("calibrationDates.list.dateField.calibration")}</option>
                <option value="created">{t("calibrationDates.list.dateField.created")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="list-from" className="block text-sm font-semibold">
                {t("calibrationDates.list.from")}
              </label>
              <input id="list-from" type="date" className={FIELD} value={filters.fromDay} onChange={(e) => change({ fromDay: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="list-to" className="block text-sm font-semibold">
                {t("calibrationDates.list.to")}
              </label>
              <input id="list-to" type="date" className={FIELD} value={filters.toDay} onChange={(e) => change({ toDay: e.target.value })} />
            </div>
            <label className="inline-flex items-center gap-2 text-sm self-end pb-2">
              <input type="checkbox" checked={filters.latestOnly} onChange={(e) => change({ latestOnly: e.target.checked })} />
              {t("calibrationDates.list.latestOnly")}
            </label>
          </div>
          {rangeInvalid && (
            <p role="alert" className="text-sm text-destructive">
              {t("calibrationDates.list.rangeInvalid")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="pt-6">
          {list.loading && <p className="text-sm text-muted-foreground">{t("calibrationDates.loading")}</p>}
          {!list.loading && list.error !== null && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("calibrationDates.list.empty")}</p>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && <RecordsTable rows={list.rows} showFacility={showFacility} />}
          <Pager meta={list.meta} onPage={list.setPage} label={t("calibrationDates.list.heading")} />
        </CardContent>
      </Card>
    </div>
  );
}

function RecordsTable({ rows, showFacility }: { rows: CalibrationRecord[]; showFacility: boolean }) {
  const text = useDatesText();
  const { t } = text;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("calibrationDates.list.heading")}</caption>
        <thead className="text-left">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.device")}</th>
            {showFacility && <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.facility")}</th>}
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.room")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.date")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.next")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.lab")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.by")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.kind")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("calibrationDates.col.verdict")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0 align-top">
              <td className="px-3 py-2">
                <span className="font-medium">{row.device?.name ?? "—"}</span>
                <span className="block font-mono text-xs text-muted-foreground">{row.device?.qrCode ?? "—"}</span>
              </td>
              {showFacility && <td className="px-3 py-2">{row.clientFacility?.name ?? "—"}</td>}
              <td className="px-3 py-2">{row.room ? [row.room.name, row.room.floor].filter((v) => v && v !== "—").join(" · ") || "—" : "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{text.date(row.calibrationDate)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{text.date(row.dueDate)}</td>
              <td className="px-3 py-2">{row.externalLabName ?? "—"}</td>
              <td className="px-3 py-2">{performer(row, t("calibrationDates.col.redacted"))}</td>
              <td className="px-3 py-2">{text.kind(row.entryKind)}</td>
              <td className="px-3 py-2">
                {row.isCompliant === false ? (
                  <StatusBadge domain="calibrationResult" state="non_compliant" size="sm">
                    {text.verdict(false)}
                  </StatusBadge>
                ) : row.isCompliant === true ? (
                  <StatusBadge domain="calibrationResult" state="compliant" size="sm">
                    {text.verdict(true)}
                  </StatusBadge>
                ) : (
                  <span className="text-muted-foreground">{text.verdict(null)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Who recorded it: the snapshot's name, "redacted" for another facility's author, else the API key. */
const performer = (row: CalibrationRecord, redacted: string): string => {
  const p = row.performerDisplay;
  if (p?.redacted) return redacted;
  if (p?.name) return p.name;
  if (row.apiKey) return row.apiKey.name;
  return "—";
};
