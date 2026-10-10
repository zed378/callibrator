"use client";

/**
 * P22-04 — what the IPM history's parts share: the page's words (Indonesian / English, `ipm.`
 * namespace, plus the catalogue's section and outcome names) with dates in the page's language, a
 * native field's classes (theme tokens only), a labelled field and the pager.
 */
import React from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import type { PageMeta } from "@/api/services/ipmHistory.service";

/** The page's translator, with instants and the IPM vocabularies in its language. */
export function useIpmText() {
  const { t, locale } = useI18n();
  const tag = locale === "id" ? "id-ID" : "en-GB";
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
  const dateOnly = new Intl.DateTimeFormat(tag, { dateStyle: "medium" });
  const instant = (format: Intl.DateTimeFormat) => (iso: string | null | undefined): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : format.format(d);
  };
  return {
    t,
    locale,
    when: instant(dateTime),
    day: instant(dateOnly),
    state: (state: string): string => t(`ipm.state.${state}` as MessageKey),
    recommendation: (value: string | null | undefined): string => (value ? t(`ipm.recommendation.${value}` as MessageKey) : t("ipm.recommendation.none")),
    overall: (value: string | null | undefined): string => (value ? t(`ipm.overall.${value}` as MessageKey) : t("ipm.overall.unset")),
    section: (value: string): string => t(`ipmCatalogue.section.${value}` as MessageKey),
    outcome: (value: string): string => t(`ipmCatalogue.outcome.${value}` as MessageKey),
    cleanliness: (value: string): string => t(`ipm.cleanliness.${value}` as MessageKey),
  };
}

/** A field class for the native controls (theme tokens only). */
export const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

/** A labelled native field's wrapper. */
export function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

/** Previous / next over a paged list; nothing when there is one page or none. */
export function Pager({ meta, onPage, label }: { meta: PageMeta | null; onPage: (page: number) => void; label: string }) {
  const { t } = useI18n();
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-border">
      <p className="text-sm text-muted-foreground">{t("ipm.pager.status", { page: meta.page, pages: meta.totalPages, total: meta.total })}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          {t("ipm.pager.previous")}
        </Button>
        <Button size="sm" variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          {t("ipm.pager.next")}
        </Button>
      </div>
    </nav>
  );
}
