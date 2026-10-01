// src/app/verify/[certificateNumber]/page.tsx
//
// P10-08 (ADR-098, doc 20 §10): the public verification page on the public
// surface. A server shell (language, metadata, not indexed) around the client
// content that asks the backend for the verdict (VerifyContent.tsx). No
// animation library, no decorative motion: zero motion (14, unchanged).
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { PublicSurface } from "@/components/public/PublicSurface";
import { BrandLockup } from "@/components/public/BrandLockup";
import { LanguageForm } from "@/components/public/LanguageForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { pickMessages } from "@/i18n";
import { VerifyContent } from "./VerifyContent";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  // Never indexed: certificate numbers in a search index are an enumeration
  // surface (docs/FRONTEND/01-ROUTING.md). next.config.ts also sends
  // `X-Robots-Tag: noindex, nofollow` on /verify/*.
  return { title: t("verify.meta.title"), robots: { index: false, follow: false } };
}

export default async function CertificateVerifyPage() {
  const { locale, messages, t } = await getServerI18n();
  return (
    <PublicSurface>
      <header className="border-b border-pub-border">
        <div className="mx-auto flex min-h-16 max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          {/* P10-13: a plain link — next/link here is ~3 KB of first-load JS for one
              link to a different document (AC-7, the 120 KB budget). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate, see above */}
          <a href="/" aria-label={t("pub.home")} className="rounded-md">
            <BrandLockup />
          </a>
          <LanguageForm locale={locale} t={t} />
        </div>
      </header>
      <main className="flex-1">
        <MessagesProvider locale={locale} messages={pickMessages(messages, ["verify."])}>
          {/* useParams / useSearchParams need a boundary under Cache Components. */}
          <Suspense
            fallback={
              <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
                <h1 className="pub-eyebrow">{t("verify.eyebrow")}</h1>
                <p role="status" className="mt-6 text-pub-muted">
                  {t("verify.loading")}
                </p>
              </div>
            }
          >
            <VerifyContent />
          </Suspense>
        </MessagesProvider>
      </main>
    </PublicSurface>
  );
}
