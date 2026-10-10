"use client";

/**
 * P22-02 — what the register's parts share: the page's words (Indonesian / English, `devices.`
 * namespace) with days in the page's language, a native field's classes (theme tokens only) and
 * the pager.
 */
import React from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import type { PageMeta } from "@/api/services/deviceRegister.service";

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The page's translator, with days and the register's vocabularies in its language. */
export function useDeviceText() {
  const { t, locale } = useI18n();
  const dates = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" });
  return {
    t,
    locale,
    /** A calendar day (`YYYY-MM-DD…`) as written, never shifted by a time zone. */
    date: (value: string | null | undefined): string => {
      const day = value ? DAY.exec(value) : null;
      if (!day) return "—";
      return dates.format(new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    },
    condition: (value: string | null | undefined): string => (value ? t(`devices.condition.${value}` as MessageKey) : t("devices.condition.unset")),
    status: (value: string | null | undefined): string => t(`devices.status.${value ?? "active"}` as MessageKey),
    due: (state: string): string => t(`devices.due.${state}` as MessageKey),
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
      <p className="text-sm text-muted-foreground">{t("devices.pager.status", { page: meta.page, pages: meta.totalPages, total: meta.total })}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          {t("devices.pager.previous")}
        </Button>
        <Button size="sm" variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          {t("devices.pager.next")}
        </Button>
      </div>
    </nav>
  );
}
