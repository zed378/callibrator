/**
 * P22-02 — the device register (/dashboard/devices): the list with photos' thumbnails, the
 * register / edit form (QR, type, condition, room, laboratory) and the two required photos
 * (F-23 … F-31).
 *
 * A server component for one reason, as the IPM checklist page (P22-01): the page is bilingual
 * (Indonesian default, English); the dictionary is read on the server from the `locale` cookie and
 * handed to the client island as only its own namespace (P10-02, pickMessages). The language toggle
 * is a plain form posting to the `setLocale` Server Action. The dashboard's `<html lang>` stays
 * English (ADR-098 §4), so the island carries its own `lang`.
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { setLocale } from "@/i18n/actions";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { LOCALES } from "@/i18n/config";
import { DevicesClient } from "./DevicesClient";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("devices.meta.title") };
}

const LANGUAGE_NAMES = { id: "Bahasa Indonesia", en: "English" } as const;

export default async function DevicesPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, ["devices."])}>
      <DevicesClient
        languageForm={
          <form action={setLocale}>
            <div role="group" aria-label={t("devices.language")} className="inline-flex rounded-md border border-border p-0.5">
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
