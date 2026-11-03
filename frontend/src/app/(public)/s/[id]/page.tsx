// P21-15 (ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 5) — the public verification of
// one e-signature application: `/s/<id>?t=<token>`, the target of its link and QR.
//
// Rendered on the SERVER per request (lib/publicEsignature.server reads the backend's one public route,
// `no-store`), so the verdict is readable without JavaScript; the only island is the "check it
// yourself" hash comparison. Under the public root layout's nonce CSP (ADR-131); one <main>, one <h1>
// (the verdict, or "Not found"); Indonesian by default with the language switch; the specimen is an
// <img> of a data URI (an image never runs script). Never indexed.
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { PublicSurface } from "@/components/public/PublicSurface";
import { BrandLockup } from "@/components/public/BrandLockup";
import { LanguageForm } from "@/components/public/LanguageForm";
import { EsignatureContent } from "./EsignatureContent";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("publicEsig.meta.title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function PublicEsignaturePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[] }> }) {
  const { locale, t } = await getServerI18n();
  return (
    <PublicSurface>
      <header className="border-b border-pub-border">
        <div className="mx-auto flex min-h-16 max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          {/* A plain link, as on /verify: next/link costs first-load JS for one link (the 120 KB budget). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate, see above */}
          <a href="/" aria-label={t("pub.home")} className="rounded-md">
            <BrandLockup />
          </a>
          <LanguageForm locale={locale} t={t} />
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12" lang={locale}>
          <Suspense
            fallback={
              <>
                {/* A paragraph, not a heading: the body brings the page's one <h1>, and the streamed shell must not add a second. */}
                <p className="pub-eyebrow">{t("publicEsig.eyebrow")}</p>
                <p role="status" className="mt-6 text-pub-muted">
                  {t("publicEsig.loading")}
                </p>
              </>
            }
          >
            <EsignatureContent params={params} searchParams={searchParams} locale={locale} t={t} />
          </Suspense>
        </div>
      </main>
    </PublicSurface>
  );
}
