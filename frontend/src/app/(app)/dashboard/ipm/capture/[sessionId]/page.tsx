/**
 * P22-03 — the IPM capture (/dashboard/ipm/capture/<session id>): the stepper over a draft's pinned
 * checklist, autosaved, then submitted. Bilingual like the history page.
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { IPM_NAMESPACES } from "../../history";
import { LanguageToggle } from "../../components/LanguageToggle";
import { CaptureClient } from "./CaptureClient";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("ipm.capture.title") };
}

export default async function IpmCapturePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { locale, messages, t } = await getServerI18n();
  const { sessionId } = await params;
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, IPM_NAMESPACES)}>
      <CaptureClient sessionId={sessionId} languageForm={<LanguageToggle locale={locale} label={t("ipm.language")} />} />
    </MessagesProvider>
  );
}
