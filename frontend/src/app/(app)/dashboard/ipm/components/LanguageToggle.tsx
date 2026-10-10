/**
 * P22-03 — the IPM pages' language toggle (server-rendered): a plain form posting to the `setLocale`
 * Server Action, each option named in its own language, the current one marked.
 */
import React from "react";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/config";

const LANGUAGE_NAMES = { id: "Bahasa Indonesia", en: "English" } as const;

export function LanguageToggle({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action={setLocale}>
      <div role="group" aria-label={label} className="inline-flex rounded-md border border-border p-0.5">
        {LOCALES.map((option) => (
          <button
            key={option}
            type="submit"
            name="locale"
            value={option}
            lang={option}
            aria-current={option === locale ? "true" : undefined}
            className={`min-h-9 rounded px-2.5 text-xs font-medium ${option === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {LANGUAGE_NAMES[option]}
          </button>
        ))}
      </div>
    </form>
  );
}
