"use client";
/**
 * P22-07 (F-70, F-71; ADR-126 Am. 6) — the devices by physical condition: the total, then good,
 * not good, broken and not assessed, each with its share and a bar, a donut of the four, and a
 * drill-down to the device register filtered by that condition (`/dashboard/devices?condition=`).
 *
 * `unset` (no condition recorded) has no list filter (Am. 6: "`condition=unset` is not a
 * device-list filter"), so its tile states the figure without a link. A link is offered only to a
 * caller who may read the register (`calibration` read, as the register's own gate).
 *
 * The figures are the server's (`GET /dashboard/metrics` → `devices.byCondition`), already scoped to
 * the tenant, or to the facility for a bound user.
 */
import React from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/MessagesProvider";
import type { DashboardMetrics } from "@/api/services/dashboard.service";

type ByCondition = DashboardMetrics["devices"]["byCondition"];
export type ConditionKey = keyof ByCondition;

/** The order the tiles and the donut show, and each one's theme colour (literal class names). */
export const CONDITIONS: readonly { key: ConditionKey; bar: string; stroke: string; text: string }[] = [
  { key: "good", bar: "bg-success", stroke: "stroke-success", text: "text-success" },
  { key: "not_good", bar: "bg-warning", stroke: "stroke-warning", text: "text-warning" },
  { key: "broken", bar: "bg-destructive", stroke: "stroke-destructive", text: "text-destructive" },
  { key: "unset", bar: "bg-muted-foreground", stroke: "stroke-muted-foreground", text: "text-muted-foreground" },
];

/** A whole-number share of the total (0 when there is none). */
export const shareOf = (count: number, total: number): number => (total > 0 ? Math.round((count / total) * 100) : 0);

/** The register filtered by a condition; null for `unset`, which has no filter. */
export const drillDownHref = (key: ConditionKey): string | null => (key === "unset" ? null : `/dashboard/devices?condition=${key}`);

/** The donut's segments: each condition's share of a 100-long circle, from twelve o'clock clockwise. */
export const donutSegments = (byCondition: ByCondition, total: number) =>
  CONDITIONS.filter((c) => byCondition[c.key] > 0).reduce<{ key: ConditionKey; stroke: string; length: number; offset: number }[]>((out, c) => {
    const previous = out[out.length - 1];
    const offset = previous ? previous.offset - previous.length : 25;
    return [...out, { key: c.key, stroke: c.stroke, length: (byCondition[c.key] / total) * 100, offset }];
  }, []);

const RADIUS = 15.915; // circumference 100: a segment's dash length is its share
const conditionKey = (key: ConditionKey) => `devices.condition.${key}` as const;

interface Props {
  byCondition: ByCondition;
  canOpenRegister: boolean;
}

export function DeviceConditionPanel({ byCondition, canOpenRegister }: Props) {
  const { t, locale } = useI18n();
  const total = CONDITIONS.reduce((sum, c) => sum + byCondition[c.key], 0);
  const summary = CONDITIONS.map((c) => `${t(conditionKey(c.key))} ${byCondition[c.key]}`).join(", ");

  const segments = donutSegments(byCondition, total);

  return (
    <section aria-labelledby="dashboard-condition-title" lang={locale} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-condition-title" className="text-lg font-semibold text-foreground">
          {t("dashboard.condition.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("dashboard.condition.lead")}</p>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("dashboard.condition.empty")}</p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,12rem)_1fr] items-center">
          <figure className="mx-auto w-40">
            <svg viewBox="0 0 42 42" role="img" aria-label={t("dashboard.condition.chart", { summary })} className="w-full h-auto">
              <circle cx="21" cy="21" r={RADIUS} fill="none" strokeWidth="6" className="stroke-muted" />
              {segments.map((s) => (
                <circle
                  key={s.key}
                  data-condition={s.key}
                  cx="21"
                  cy="21"
                  r={RADIUS}
                  fill="none"
                  strokeWidth="6"
                  strokeDasharray={`${s.length} ${100 - s.length}`}
                  strokeDashoffset={s.offset}
                  className={s.stroke}
                />
              ))}
              <text x="21" y="22.5" textAnchor="middle" className="fill-foreground text-[0.5rem] font-semibold">
                {total}
              </text>
            </svg>
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">{t("dashboard.condition.total", { count: total })}</figcaption>
          </figure>

          <ul className="grid gap-3 sm:grid-cols-2">
            {CONDITIONS.map((c) => {
              const count = byCondition[c.key];
              const share = shareOf(count, total);
              const href = canOpenRegister ? drillDownHref(c.key) : null;
              const label = t(conditionKey(c.key));
              return (
                <li key={c.key} className="rounded-xl border border-border p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className={`text-2xl font-bold ${c.text}`}>{count}</span>
                  </div>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={t("dashboard.condition.share", { condition: label })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={share}
                  >
                    <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${share}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("dashboard.condition.percent", { percent: share })}</span>
                    {href ? (
                      <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
                        {t("dashboard.condition.open", { condition: label })}
                      </Link>
                    ) : c.key === "unset" ? (
                      <span>{t("dashboard.condition.unsetNote")}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export default DeviceConditionPanel;
