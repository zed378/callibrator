// src/app/request-access/page.tsx
//
// P10-06 (ADR-098 §6, doc 20 §8): Request access replaces self-registration
// (/register redirects here with a 308, next.config.ts). The frontend no
// longer calls POST /auth/register.
import React from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { AuthShell } from "@/components/public/AuthShell";
import { RequestAccessForm } from "./components/RequestAccessForm";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("access.meta.title") };
}

export default async function RequestAccessPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <AuthShell locale={locale} messages={messages} t={t} namespaces={["access."]} wide>
      <RequestAccessForm />
    </AuthShell>
  );
}
