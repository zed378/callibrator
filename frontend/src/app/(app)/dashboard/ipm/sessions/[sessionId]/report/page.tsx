/**
 * P23-02 — the IPM report (/dashboard/ipm/sessions/<id>/report): the accessible on-screen report,
 * its PDF download (rendered in the browser, in the language chosen) and the signatures. The page's
 * own words follow the `locale` cookie; the PDF's labels are handed over in both languages.
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { getMessages, pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { LanguageToggle } from "../../../components/LanguageToggle";
import { ReportClient } from "./ReportClient";

const NAMESPACES = ["ipmReport.", "ipmCatalogue.section.", "ipmCatalogue.outcome."];

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("ipmReport.page.metaTitle") };
}

export default async function IpmReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { locale, messages, t } = await getServerI18n();
  const { sessionId } = await params;
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, NAMESPACES)}>
      <ReportClient
        sessionId={sessionId}
        pdfMessages={{ id: pickMessages(getMessages("id"), NAMESPACES), en: pickMessages(getMessages("en"), NAMESPACES) }}
        languageForm={<LanguageToggle locale={locale} label={t("ipmReport.page.language")} />}
      />
    </MessagesProvider>
  );
}
