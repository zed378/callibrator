/**
 * P10-13 (ADR-098 §1): the frame blog and news pages render in — the public
 * surface, the skip link, the public header (its section anchors lead back to
 * the landing) and the public footer. It replaces the old landing layout there, which
 * loaded Lenis, GSAP and the old navigation on every blog and news page.
 *
 * Server component: the only client JavaScript is the header's menu button.
 */
import React from "react";
import { PublicSurface } from "./PublicSurface";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

export function ContentShell({ locale, t, children }: { locale: Locale; t: Translate; children: React.ReactNode }) {
  return (
    <PublicSurface>
      <a href="#konten" className="pub-skip">
        {t("pub.skip")}
      </a>
      <PublicHeader locale={locale} t={t} anchorBase="/" />
      {/* At least a viewport tall: the posts stream in after the shell, and a
          footer drawn above the fold that then moves (down as an article
          arrives, up when a list is short) measured CLS 0.28–0.32 (P10-13). */}
      <main id="konten" tabIndex={-1} className="min-h-[100svh] flex-1 outline-none">
        {children}
      </main>
      <PublicFooter locale={locale} t={t} year={new Date().getFullYear()} />
    </PublicSurface>
  );
}

export default ContentShell;
