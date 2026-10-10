"use client";
/**
 * P22-07 (F-70, F-73; ADR-126 Am. 6 § 1) — the IPM figures of `GET /dashboard/metrics`: visits
 * submitted in the last 30 days, and "due" this month (`{ scheduled, due, neverInspected }`, the rule
 * of `GET /ipm/due`). `due` is null in the super admin's global view (each tenant has its own
 * interval and zone): the panel says so rather than showing zeros. The history link is offered only
 * to an `ipm` reader.
 */
import React from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/MessagesProvider";
import type { DashboardMetrics } from "@/api/services/dashboard.service";

/** The window `sessionsLast30Days` counts (the server's). */
export const IPM_RECENT_DAYS = 30;

interface Props {
  ipm: DashboardMetrics["ipm"];
  canOpenHistory: boolean;
}

function Figure({ label, value, tone = "text-foreground" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold ${tone}`}>{value}</dd>
    </div>
  );
}

export function IpmPanel({ ipm, canOpenHistory }: Props) {
  const { t, locale } = useI18n();
  return (
    <section aria-labelledby="dashboard-ipm-title" lang={locale} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-ipm-title" className="text-lg font-semibold text-foreground">
          {t("dashboard.ipm.title")}
        </h2>
        {canOpenHistory && (
          <Link href="/dashboard/ipm" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            {t("dashboard.ipm.open")}
          </Link>
        )}
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t("dashboard.ipm.recent", { days: IPM_RECENT_DAYS })} value={ipm.sessionsLast30Days} tone="text-primary" />
        {ipm.due && (
          <>
            <Figure label={t("dashboard.ipm.due")} value={ipm.due.due} tone="text-warning" />
            <Figure label={t("dashboard.ipm.neverInspected")} value={ipm.due.neverInspected} tone="text-destructive" />
            <Figure label={t("dashboard.ipm.scheduled")} value={ipm.due.scheduled} />
          </>
        )}
      </dl>
      {!ipm.due && <p className="mt-3 text-sm text-muted-foreground">{t("dashboard.ipm.globalNote")}</p>}
    </section>
  );
}

export default IpmPanel;
