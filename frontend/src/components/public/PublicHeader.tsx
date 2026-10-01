/**
 * P10-03 (doc 20 §6.0): the public header. Logo · section anchors · language
 * form · Sign in (secondary) · Contact us (primary). Below 1024 px the anchors
 * and actions move into a disclosure menu. Server component; the only client
 * island is the menu button.
 */
import React from "react";
import Link from "next/link";
import { BrandLockup } from "./BrandLockup";
import { LanguageForm } from "./LanguageForm";
import { MobileMenu } from "./MobileMenu";
import type { Locale } from "@/i18n/config";
import type { MessageKey, Translate } from "@/i18n";

export const LANDING_ANCHORS: ReadonlyArray<{ id: string; key: MessageKey }> = [
  { id: "fitur", key: "pub.nav.features" },
  { id: "alur-kerja", key: "pub.nav.workflow" },
  { id: "keamanan", key: "pub.nav.security" },
  { id: "verifikasi", key: "pub.nav.verify" },
  { id: "faq", key: "pub.nav.faq" },
];

export function PublicHeader({
  locale,
  t,
  anchorBase = "",
}: {
  locale: Locale;
  t: Translate;
  /**
   * P10-13: where the section anchors live. "" on the landing (same-page
   * `#fitur`); "/" on blog and news, whose anchors lead back to the landing.
   */
  anchorBase?: "" | "/";
}) {
  return (
    <header className="pub-header">
      <div className="relative mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label={t("pub.home")} className="rounded-md">
          <BrandLockup />
        </Link>

        <nav aria-label={t("pub.nav.label")} className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {LANDING_ANCHORS.map((a) => (
              <li key={a.id}>
                <a href={`${anchorBase}#${a.id}`} className="pub-link-quiet text-[0.9375rem]">
                  {t(a.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <LanguageForm locale={locale} t={t} />
          <Link href="/login" className="pub-btn pub-btn-secondary">
            {t("pub.nav.signin")}
          </Link>
          <a href={`${anchorBase}#kontak`} className="pub-btn pub-btn-primary">
            {t("pub.nav.contact")}
          </a>
        </div>

        <MobileMenu openLabel={t("pub.nav.menuOpen")} closeLabel={t("pub.nav.menuClose")}>
          <ul className="flex flex-col">
            {LANDING_ANCHORS.map((a) => (
              <li key={a.id}>
                <a href={`${anchorBase}#${a.id}`} className="pub-link-quiet block py-3 text-base">
                  {t(a.key)}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <Link href="/login" className="pub-btn pub-btn-secondary">
              {t("pub.nav.signin")}
            </Link>
            <a href={`${anchorBase}#kontak`} className="pub-btn pub-btn-primary">
              {t("pub.nav.contact")}
            </a>
            <div>
              <LanguageForm locale={locale} t={t} />
            </div>
          </div>
        </MobileMenu>
      </div>
    </header>
  );
}

export default PublicHeader;
