/**
 * P22-06 — the exports (/dashboard/exports): the inventory list as PDF or XLSX and the calibration
 * recaps as XLSX, rendered in the browser from paged reads (F-65 … F-69; ADR-126 § 8).
 *
 * A server component for the same reason as the device register (P22-02): the page is bilingual
 * (Indonesian default, English); the dictionary is read on the server from the `locale` cookie and
 * handed to the client island as only its own namespace (`exports.`). The language toggle posts to
 * the `setLocale` Server Action. Reached from the reports page and the device register (no menu
 * entry of its own).
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { setLocale } from "@/i18n/actions";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { LOCALES } from "@/i18n/config";
import { ExportsClient } from "./ExportsClient";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("exports.meta.title") };
}

const LANGUAGE_NAMES = { id: "Bahasa Indonesia", en: "English" } as const;

export default async function ExportsPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, ["exports."])}>
      <ExportsClient
        languageForm={
          <form action={setLocale}>
            <div role="group" aria-label={t("exports.language")} className="inline-flex rounded-md border border-border p-0.5">
              {LOCALES.map((option) => (
                <button
                  key={option}
                  type="submit"
                  name="locale"
                  value={option}
                  lang={option}
                  aria-current={option === locale ? "true" : undefined}
                  className={`min-h-9 rounded px-2.5 text-xs font-medium ${
                    option === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {LANGUAGE_NAMES[option]}
                </button>
              ))}
            </div>
          </form>
        }
      />
    </MessagesProvider>
  );
}
