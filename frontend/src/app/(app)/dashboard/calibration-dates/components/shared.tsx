"use client";

/**
 * P22-05 — what the two panels share: the page's words (Indonesian / English, `calibrationDates.`
 * namespace), days and instants in the page's language, the pager, and a native field's classes
 * (theme tokens only).
 */
import React from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import type { PageMeta } from "@/api/services/calibrationDates.service";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The page's translator, with days and instants in its language. */
export function useDatesText() {
  const { t, locale } = useI18n();
  const dates = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" });
  return {
    t,
    locale,
    /**
     * A calendar day (`YYYY-MM-DD`) as written — read as that day, never shifted by a time zone.
     * An instant (a record's `calibrationDate`, 00:00 of the tenant's zone) is shown in the browser's
     * zone, which is the tenant's for the people who use this page.
     */
    date: (value: string | null | undefined): string => {
      if (!value) return "—";
      const day = DAY.exec(value);
      if (day) return dates.format(new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
      return dates.format(new Date(value));
    },
    due: (state: string): string => t(`calibrationDates.due.${state}` as MessageKey),
    kind: (kind: string | null | undefined): string => (kind ? t(`calibrationDates.kind.${kind}` as MessageKey) : "—"),
    verdict: (isCompliant: boolean | null | undefined): string =>
      isCompliant === true
        ? t("calibrationDates.verdict.compliant")
        : isCompliant === false
          ? t("calibrationDates.verdict.non_compliant")
          : t("calibrationDates.verdict.unstated"),
  };
}

/** A field class for the native controls (theme tokens only). */
export const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

/** Previous / next over a paged list; nothing when there is one page or none. */
export function Pager({ meta, onPage, label }: { meta: PageMeta | null; onPage: (page: number) => void; label: string }) {
  const { t } = useI18n();
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-2 pt-3">
      <p className="text-sm text-muted-foreground">
        {t("calibrationDates.pager.status", { page: meta.page, pages: meta.totalPages, total: meta.total })}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          {t("calibrationDates.pager.previous")}
        </Button>
        <Button size="sm" variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          {t("calibrationDates.pager.next")}
        </Button>
      </div>
    </nav>
  );
}
