/**
 * P22-03 — start an IPM (/dashboard/ipm/new): the device by its QR sticker (typed, a handheld
 * scanner or the camera), then the draft. Bilingual like the history page (the dictionary picked on
 * the server, handed to the island). The camera is allowed on this path only (ADR-127 Am. 2).
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { IPM_NAMESPACES } from "../history";
import { LanguageToggle } from "../components/LanguageToggle";
import { StartClient } from "./StartClient";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("ipm.start.title") };
}

export default async function IpmStartPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, IPM_NAMESPACES)}>
      <StartClient languageForm={<LanguageToggle locale={locale} label={t("ipm.language")} />} />
    </MessagesProvider>
  );
}
