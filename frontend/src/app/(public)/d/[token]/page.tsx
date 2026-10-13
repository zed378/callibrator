// P22-08 (ADR-138 § 7, Am. 1; spec MEMORY/specs/P19-07-public-device-page.md § 10) — the public
// device page a sticker's QR opens: `/d/<token>`.
//
// Rendered on the SERVER per request (lib/publicDevice.server reads the backend's one public route,
// `no-store`), so it is readable without JavaScript and ships no island but the shared language form.
// Under the public root layout's nonce CSP (ADR-131); one <main>, one <h1> (the device's name, or
// "Not found"); Indonesian by default with the language switch; theme tokens only; a status is the
// WORD with an icon, never colour alone. Never indexed (metadata here; next.config.ts sends
// `X-Robots-Tag` and `Referrer-Policy: no-referrer` on /d/*; robots.ts disallows /d/).
//
// Status code: under Cache Components a dynamic route streams its shell as 200 first, so every
// outcome — found, not found, rate-limited, failed — answers 200 with its own text and `noindex`
// (next/dist/docs, not-found § status codes). The API's own answer is the 404; the page adds no
// distinction of its own.
import React, { Suspense } from "react";
import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import { PublicSurface } from "@/components/public/PublicSurface";
import { BrandLockup } from "@/components/public/BrandLockup";
import { LanguageForm } from "@/components/public/LanguageForm";
import { DeviceContent } from "./DeviceContent";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return { title: t("publicDevice.meta.title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function PublicDevicePage({ params }: { params: Promise<{ token: string }> }) {
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
                <h1 className="pub-eyebrow">{t("publicDevice.eyebrow")}</h1>
                <p role="status" className="mt-6 text-pub-muted">
                  {t("publicDevice.loading")}
                </p>
              </>
            }
          >
            <DeviceContent params={params} locale={locale} t={t} />
          </Suspense>
        </div>
      </main>
    </PublicSurface>
  );
}
