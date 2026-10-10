/**
 * P22-09 — the client facilities (/dashboard/client-facilities): the facilities a calibration
 * company serves and their bound users, administered by its tenant administrators. Bilingual like
 * the other upstream pages (the `facilities.` namespace picked on the server).
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { LanguageToggle } from "../ipm/components/LanguageToggle";
import { FacilitiesClient } from "./FacilitiesClient";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("facilities.title") };
}

export default async function ClientFacilitiesPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, ["facilities."])}>
      <FacilitiesClient languageForm={<LanguageToggle locale={locale} label={t("facilities.language")} />} />
    </MessagesProvider>
  );
}
