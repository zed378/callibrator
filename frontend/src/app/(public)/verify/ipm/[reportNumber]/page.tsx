// P23-02 (P19-06 § 9.4): the public verification of an IPM report, on the public surface beside the
// certificate's (`/verify/[certificateNumber]`): a server shell (language, metadata, never indexed —
// next.config.ts also sends `X-Robots-Tag: noindex, nofollow` on /verify/*) around the client content
// that asks the backend for the verdict. Indonesian first (the public locale). The PDF's labels are
// handed to the island in the page's language; the renderer itself loads only on "Download".
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { PublicSurface } from "@/components/public/PublicSurface";
import { BrandLockup } from "@/components/public/BrandLockup";
import { LanguageForm } from "@/components/public/LanguageForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { pickMessages } from "@/i18n";
import { VerifyIpmContent } from "./VerifyIpmContent";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("verifyIpm.meta.title"), robots: { index: false, follow: false } };
}

export default async function IpmVerifyPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <PublicSurface>
      <header className="border-b border-pub-border">
        <div className="mx-auto flex min-h-16 max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          {/* A plain link, as on the certificate's page: next/link costs first-load JS for one link (the 120 KB budget). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate, see above */}
          <a href="/" aria-label={t("pub.home")} className="rounded-md">
            <BrandLockup />
          </a>
          <LanguageForm locale={locale} t={t} />
        </div>
      </header>
      <main className="flex-1">
        <MessagesProvider locale={locale} messages={pickMessages(messages, ["verifyIpm.", "ipmReport.rec.", "ipmReport.sig.performer", "ipmReport.sig.countersign"])}>
          <Suspense
            fallback={
              <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
                <h1 className="pub-eyebrow">{t("verifyIpm.eyebrow")}</h1>
                <p role="status" className="mt-6 text-pub-muted">
                  {t("verifyIpm.loading")}
                </p>
              </div>
            }
          >
            <VerifyIpmContent pdfMessages={pickMessages(messages, ["ipmReport.", "ipmCatalogue.section.", "ipmCatalogue.outcome."])} />
          </Suspense>
        </MessagesProvider>
      </main>
    </PublicSurface>
  );
}
