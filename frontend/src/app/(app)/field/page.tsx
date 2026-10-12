/**
 * P22-10c2 — `/field`, the offline field app (P19-08 § 3): ONE document whose screens are client
 * state (`?view=…`). The server renders only the shell and the words of the request's language
 * (Indonesian by default; `field.`, plus the IPM capture's and the catalogue's names it reuses).
 * Every tenant value is read in the browser — from the encrypted store, or the API when online —
 * never here: the document is what the service worker keeps for offline use (FT-84, FT-89).
 */
import React from "react";
import { getServerI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { FIELD_NAMESPACES } from "@/field/ui/namespaces";
import { FieldClient } from "./FieldClient";

export async function generateMetadata() {
  const { t } = await getServerI18n();
  return { title: t("field.meta.title") };
}

export default async function FieldPage() {
  const { locale, messages } = await getServerI18n();
  return (
    <MessagesProvider locale={locale} messages={pickMessages(messages, FIELD_NAMESPACES)}>
      <FieldClient />
    </MessagesProvider>
  );
}
