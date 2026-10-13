/**
 * The tenants page (/dashboard/tenants). A server shell since M-18 (2026-10-13): it picks the
 * `tenantSettings.` messages (ID/EN) for the IPM and public-page settings panel and renders the
 * client island, which is the page as it was.
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { TenantsClient } from "./TenantsClient";

export default async function TenantsPage() {
  const { locale, messages } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, ["tenantSettings."])}>
      <TenantsClient />
    </MessagesProvider>
  );
}
