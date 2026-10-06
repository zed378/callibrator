// src/app/login/page.tsx
//
// P10-04 (ADR-098 §9, doc 20 §7): sign-in on the public surface. A server
// component: it reads the language, renders the split-screen shell, and hands
// the client form only the `auth.*` strings it uses. No animation library
// loads here (Motion drove the old tab indicator, 05 §7.2).
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { AuthShell } from "@/components/public/AuthShell";
import { LoginPanel } from "./components/LoginPanel";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("auth.meta.title") };
}

export default async function LoginPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <AuthShell locale={locale} messages={messages} t={t} namespaces={["auth.", "landing.hero.greeting."]}>
      {/* useSearchParams (callbackUrl, ?error=, ?org=) needs a boundary under Cache Components. */}
      <Suspense fallback={<h1 className="pub-display pub-display-m text-pub-text">{t("auth.login.title")}</h1>}>
        <LoginPanel />
      </Suspense>
    </AuthShell>
  );
}
