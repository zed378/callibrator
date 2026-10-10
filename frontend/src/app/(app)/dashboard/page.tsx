/**
 * The dashboard home (/dashboard). P22-07: a server component for one reason, as the device register
 * (P22-02): the panels P22-07 adds are bilingual (Indonesian default, English), so the dictionary is
 * read on the server from the `locale` cookie and handed to the client island as only its own
 * namespaces (P10-02, pickMessages). The rest of the dashboard is unchanged (English).
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { DashboardClient } from "./DashboardClient";

/** The dictionary namespaces the island reads. */
const DASHBOARD_NAMESPACES = ["dashboard.", "devices.condition."];

export default async function DashboardPage() {
  const { locale, messages } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, DASHBOARD_NAMESPACES)}>
      <DashboardClient />
    </MessagesProvider>
  );
}
