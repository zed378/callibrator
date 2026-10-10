/**
 * P22-04 — the IPM history (/dashboard/ipm): every visit, one visit with its results and lineage,
 * corrections and the void (F-54 … F-57). `?deviceId=<uuid>` narrows it to one device (the device
 * register's "IPM history" action).
 *
 * A server component for the same reason as the device register (P22-02): the page is bilingual
 * (Indonesian default, English); the dictionary is read on the server from the `locale` cookie and
 * handed to the client island as only its own namespaces (`ipm.`, plus the catalogue's section and
 * outcome names). The language toggle posts to the `setLocale` Server Action.
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { setLocale } from "@/i18n/actions";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { LOCALES } from "@/i18n/config";
import { IpmClient } from "./IpmClient";
import { IPM_NAMESPACES, deviceIdOf } from "./history";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("ipm.meta.title") };
}

const LANGUAGE_NAMES = { id: "Bahasa Indonesia", en: "English" } as const;

export default async function IpmPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, messages, t } = await getServerI18n();
  const params = (await searchParams) ?? {};
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, IPM_NAMESPACES)}>
      <IpmClient
        deviceId={deviceIdOf(params["deviceId"])}
        languageForm={
          <form action={setLocale}>
            <div role="group" aria-label={t("ipm.language")} className="inline-flex rounded-md border border-border p-0.5">
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
