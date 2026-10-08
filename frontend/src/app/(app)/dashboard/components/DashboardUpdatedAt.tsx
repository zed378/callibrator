"use client";
/**
 * U-06b (ADR-120): when the dashboard's figures were computed. The backend
 * serves them from a cache of up to 30 seconds per tenant, so the page says
 * how old they are: "Updated at HH:MM:SS" / "Diperbarui pukul HH:MM:SS", in
 * the browser's local time, in the language of the `locale` cookie (the public
 * surfaces' choice; Indonesian when unset).
 *
 * The two strings live here, not in the i18n dictionaries: the dashboard is
 * English until Phase 11 decides its language (ADR-098 §4), and this one line
 * is the exception. `lang` is set on the element so the Indonesian line is
 * announced as Indonesian on an English page.
 */
import React from "react";
import { useClientValue } from "@/hooks/useClientValue";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/config";

const LABEL: Readonly<Record<Locale, string>> = {
  id: "Diperbarui pukul",
  en: "Updated at",
};

/** The `locale` cookie, resolved (absent or unknown → the default, Indonesian). */
export const readLocaleCookie = (cookie: string): Locale => {
  const prefix = `${LOCALE_COOKIE}=`;
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return resolveLocale(entry ? decodeURIComponent(entry.slice(prefix.length)) : null);
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** HH:MM:SS, 24-hour, local time; null for an unreadable timestamp. */
export const formatClock = (iso: string): string | null => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
};

const readBrowserLocale = (): Locale => readLocaleCookie(document.cookie);

export default function DashboardUpdatedAt({ generatedAt }: { generatedAt: string }) {
  const locale = useClientValue(readBrowserLocale, "en" as Locale);
  const clock = formatClock(generatedAt);
  if (!clock) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground" lang={locale}>
      {LABEL[locale]} <time dateTime={generatedAt}>{clock}</time>
    </p>
  );
}
