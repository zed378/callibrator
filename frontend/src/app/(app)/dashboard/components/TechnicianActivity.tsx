"use client";
/**
 * P22-07 (F-73; ADR-126 Am. 6 § 5) — technician activity on the dashboard: the latest submitted,
 * effective IPM visits (`GET /ipm/sessions?status=submitted&effective=true&sort=performedAt`, rows in
 * `data`, paging in the top-level `meta`), searchable by device or QR (`q`) and narrowed to the
 * caller's own visits (`performedBy`). For a bound user the server answers its facility's visits
 * only (C-12). Shown to an `ipm` reader; the whole history is one link away.
 *
 * Each row prints the visit's own snapshots (device name, QR, serial number, facility) as submitted,
 * and the performer as the server displays them (a redacted performer reads as "—").
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/MessagesProvider";
import { deferEffect } from "@/lib/deferEffect";
import { ipmHistoryService, type IpmSessionListQuery, type IpmSessionSummary } from "@/api/services/ipmHistory.service";

/** How many visits the dashboard shows. */
export const ACTIVITY_LIMIT = 5;

type Recommendation = NonNullable<IpmSessionSummary["recommendation"]>;

/** The query for the dashboard's list: only what is set is sent. */
export const activityQuery = (q: string, performedBy: string | null): IpmSessionListQuery => ({
  page: 1,
  limit: ACTIVITY_LIMIT,
  status: "submitted",
  effective: true,
  sort: "performedAt",
  ...(q.trim() ? { q: q.trim() } : {}),
  ...(performedBy ? { performedBy } : {}),
});

/** A text value of a snapshot, or null. */
export const snapshotText = (snapshot: Record<string, unknown> | null, key: string): string | null => {
  const value = snapshot?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const DASH = "—";

interface Props {
  /** The caller's user id, for "only my visits"; null hides the toggle. */
  userId: string | null;
}

export function TechnicianActivity({ userId }: Props) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<IpmSessionSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const page = await ipmHistoryService.list(activityQuery(search, mine ? userId : null));
      setRows(page.rows);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [search, mine, userId]);

  useEffect(() => deferEffect(load), [load]);

  const dateFormat = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" });
  const recommendation = (r: Recommendation | null): string => (r ? t(`dashboard.activity.rec.${r}`) : DASH);

  return (
    <section aria-labelledby="dashboard-activity-title" lang={locale} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="dashboard-activity-title" className="text-lg font-semibold text-foreground">
            {t("dashboard.activity.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("dashboard.activity.lead")}</p>
        </div>
        <Link href="/dashboard/ipm" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
          {t("dashboard.activity.all")}
        </Link>
      </div>

      <form
        role="search"
        aria-label={t("dashboard.activity.searchLabel")}
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="dashboard-activity-q" className="text-xs font-medium text-muted-foreground">
            {t("dashboard.activity.searchLabel")}
          </label>
          <input
            id="dashboard-activity-q"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            className="min-h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
        </div>
        <button type="submit" className="min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          {t("dashboard.activity.search")}
        </button>
        {userId && (
          <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            {t("dashboard.activity.mine")}
          </label>
        )}
      </form>

      <div className="mt-4" aria-live="polite">
        {state === "loading" && <p className="text-sm text-muted-foreground">{t("dashboard.activity.loading")}</p>}
        {state === "failed" && (
          <p className="text-sm text-destructive" role="alert">
            {t("dashboard.activity.failed")}{" "}
            <button type="button" onClick={() => void load()} className="font-medium underline">
              {t("dashboard.activity.retry")}
            </button>
          </p>
        )}
        {state === "ready" && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("dashboard.activity.empty")}</p>}
        {state === "ready" && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("dashboard.activity.title")}</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("dashboard.activity.col.date")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("dashboard.activity.col.device")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("dashboard.activity.col.qr")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("dashboard.activity.col.serial")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("dashboard.activity.col.facility")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("dashboard.activity.col.technician")}</th>
                  <th scope="col" className="py-2 font-medium">{t("dashboard.activity.col.recommendation")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="text-foreground">
                    <td className="py-2 pr-3 whitespace-nowrap">{dateFormat.format(new Date(row.performedAt))}</td>
                    <td className="py-2 pr-3">{snapshotText(row.deviceSnapshot, "name") ?? DASH}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{snapshotText(row.deviceSnapshot, "qrCode") ?? DASH}</td>
                    <td className="py-2 pr-3">{snapshotText(row.deviceSnapshot, "serialNumber") ?? DASH}</td>
                    <td className="py-2 pr-3">{snapshotText(row.facilitySnapshot, "name") ?? DASH}</td>
                    <td className="py-2 pr-3">{row.performerDisplay?.name ?? DASH}</td>
                    <td className="py-2">{recommendation(row.recommendation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default TechnicianActivity;
