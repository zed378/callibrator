// src/app/invitation/page.tsx
//
// P10-15 (ADR-098 §8.4, Q-45): the first administrator of an approved request
// sets their own password from the single-use invitation link. No temporary
// password ever travels.
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { AuthShell } from "@/components/public/AuthShell";
import { InvitationForm } from "./components/InvitationForm";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  // The token is in the URL until the page strips it: never send it on as a Referer.
  return { title: t("invite.meta.title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function InvitationPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <AuthShell
      locale={locale}
      messages={messages}
      t={t}
      namespaces={["invite.", "reset.rule", "auth.first.", "auth.login.showPassword", "auth.login.hidePassword"]}
    >
      <Suspense fallback={<h1 className="pub-display pub-display-m text-pub-text">{t("invite.title")}</h1>}>
        <InvitationForm />
      </Suspense>
    </AuthShell>
  );
}
