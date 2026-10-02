// src/app/request-access/page.tsx
//
// P10-06 (ADR-098 §6, doc 20 §8): Request access replaces self-registration
// (/register redirects here with a 308, next.config.ts). The frontend no
// longer calls POST /auth/register.
//
// Q-42 (ADR-113): a form collecting personal data does not open before its
// privacy notice exists. With PRIVACY_NOTICE_URL unset (read here, on the
// server, per request) the page shows a short neutral "not open yet" notice
// and the configured contact channels instead of the form — and the backend
// answers the intake with the absent-route 404.
import React from "react";
import type { Metadata } from "next";
import { Mail, MessageCircle } from "lucide-react";
import { getServerI18n } from "@/i18n/server";
import type { Translate } from "@/i18n";
import { AuthShell } from "@/components/public/AuthShell";
import { contactChannels } from "@/components/public/contact";
import { privacyNoticeUrl } from "@/components/public/privacyNotice";
import { RequestAccessForm } from "./components/RequestAccessForm";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("access.meta.title") };
}

/** The intake is closed: say so plainly, and offer only the channels that exist (Q-41). */
function RequestAccessClosed({ t }: { t: Translate }) {
  const channels = contactChannels({
    whatsappText: t("landing.contact.whatsappText"),
    emailSubject: t("landing.contact.emailSubject"),
  });
  const any = channels.whatsappUrl !== null || channels.emailUrl !== null;
  return (
    <div>
      <h1 className="pub-display pub-display-m text-pub-text">{t("access.closed.title")}</h1>
      <p className="pub-body-l mt-4 text-pub-muted">{t(any ? "access.closed.lead" : "access.closed.leadNoChannels")}</p>
      {any ? (
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {channels.whatsappUrl ? (
            <a href={channels.whatsappUrl} className="pub-btn pub-btn-primary" rel="noopener noreferrer" target="_blank">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t("landing.hero.ctaWhatsapp")}
            </a>
          ) : null}
          {channels.emailUrl ? (
            <a
              href={channels.emailUrl}
              className={`pub-btn ${channels.whatsappUrl ? "pub-btn-secondary" : "pub-btn-primary"}`}
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t("landing.hero.ctaEmail")}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default async function RequestAccessPage() {
  const { locale, messages, t } = await getServerI18n();
  const notice = privacyNoticeUrl();
  return (
    <AuthShell locale={locale} messages={messages} t={t} namespaces={["access."]} wide>
      {notice ? <RequestAccessForm privacyNoticeUrl={notice} /> : <RequestAccessClosed t={t} />}
    </AuthShell>
  );
}
