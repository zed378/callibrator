/**
 * P10-03 (doc 20 §6.8): only links that have a destination. The privacy link
 * appears once the notice exists (Q-42); social links only if the owner
 * supplies real accounts. The copyright line reads `© {year} Device Calibrator`
 * until the owner names the legal entity (Q-43).
 */
import React from "react";
import Link from "next/link";
import { BrandLockup } from "./BrandLockup";
import { LanguageForm } from "./LanguageForm";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

export function PublicFooter({ locale, t, year }: { locale: Locale; t: Translate; year: number }) {
  return (
    <footer className="border-t border-pub-border">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <BrandLockup />
          <p className="pub-caption mt-4 max-w-sm text-pub-muted">{t("pub.footer.tagline")}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-pub-text">{t("pub.footer.product")}</h2>
          <ul className="mt-4 space-y-3 text-[0.9375rem]">
            <li>
              <Link href="/login" className="pub-link-quiet">
                {t("pub.footer.signin")}
              </Link>
            </li>
            <li>
              <Link href="/request-access" className="pub-link-quiet">
                {t("pub.footer.request")}
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-pub-text">{t("pub.footer.resources")}</h2>
          <ul className="mt-4 space-y-3 text-[0.9375rem]">
            <li>
              <Link href="/blog" className="pub-link-quiet">
                {t("pub.footer.blog")}
              </Link>
            </li>
            <li>
              <Link href="/news" className="pub-link-quiet">
                {t("pub.footer.news")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-4 border-t border-pub-border px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <p className="pub-caption text-pub-subtle">{t("pub.footer.copyright", { year })}</p>
        <LanguageForm locale={locale} t={t} />
      </div>
    </footer>
  );
}

export default PublicFooter;
