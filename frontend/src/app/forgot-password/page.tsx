// src/app/forgot-password/page.tsx
//
// P10-09 (doc 20 §9): the reset page the backend's OTP flow never had.
import React from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { AuthShell } from "@/components/public/AuthShell";
import { ForgotPasswordForm } from "./components/ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("reset.meta.title") };
}

export default async function ForgotPasswordPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <AuthShell locale={locale} messages={messages} t={t} namespaces={["reset.", "auth.login.showPassword"]}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
