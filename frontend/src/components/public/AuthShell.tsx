/**
 * P10-04 (doc 20 §7.1): the split-screen every auth page shares — /login,
 * /request-access, /forgot-password, /invitation. P10-17 (ADR-118, brief §19)
 * redesigned it in the landing's language, calmer:
 *
 * Left (≥ 1024 px only): an editorial photograph of someone at work, a warm
 * veil, one quiet line in the display serif, and a small paper certificate
 * whose QR code "forms" once as the page loads (CSS only; still under reduced
 * motion). No dashboard screenshot, no claims, no heading — the page's single
 * <h1> is in the form column, at every width. The photograph is lazy and never
 * blocks the form.
 * Below 1024 px the visual collapses to a thin warm band at the top, so the
 * form keeps the screen (and stays above the on-screen keyboard).
 * Right: back link, language form, then the page's own content in <main>.
 *
 * Server component. The client islands (the forms) are passed in as children,
 * wrapped in a MessagesProvider holding only the namespaces they use.
 */
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicSurface } from "./PublicSurface";
import { BrandLockup } from "./BrandLockup";
import { LanguageForm } from "./LanguageForm";
import { PublicThemeToggle } from "./PublicThemeToggle";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { pickMessages, type Messages, type Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { LANDING_PHOTOS } from "./landing/photos";
import { DemoQr } from "./landing/DemoQr";

export function AuthShell({
  locale,
  messages,
  t,
  namespaces,
  wide = false,
  panelLine,
  children,
}: {
  locale: Locale;
  messages: Messages;
  t: Translate;
  /** Dictionary prefixes the client forms need, e.g. ["auth."]. */
  namespaces: readonly string[];
  /** The request-access form is longer and wider than sign-in. */
  wide?: boolean;
  /** The panel's one line; defaults to `auth.panel.line`. */
  panelLine?: string;
  children: React.ReactNode;
}) {
  const photo = LANDING_PHOTOS.technician;
  return (
    <PublicSurface>
      <div className="auth-band lg:hidden" aria-hidden="true" />
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside aria-hidden="true" className="auth-visual relative hidden overflow-hidden lg:block">
          <Image
            src={photo.src}
            width={photo.width}
            height={photo.height}
            alt=""
            sizes="(min-width: 1024px) 45vw, 1px"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="auth-veil" />
          <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
            <div className="auth-brand-chip self-start">
              <BrandLockup />
            </div>
            <div>
              <div className="auth-cert">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2 pt-1">
                    <span className="auth-cert-line w-24" />
                    <span className="auth-cert-line w-16" />
                    <span className="auth-cert-line w-20" />
                  </div>
                  <div className="auth-cert-qr w-20">
                    <DemoQr label="" />
                  </div>
                </div>
                <p className="mt-4 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-pub-subtle">
                  {t("landing.hero.sampleCaption")}
                </p>
              </div>
              <p className="auth-line mt-8 max-w-[26rem]">{panelLine ?? t("auth.panel.line")}</p>
              <p className="auth-caption mt-4">{t("auth.panel.caption")}</p>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col bg-pub-bg">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-5 sm:px-8">
            <Link href="/" prefetch={false} className="pub-link-quiet inline-flex min-h-11 items-center text-sm">
              {t("auth.back")}
            </Link>
            <div className="flex items-center gap-2">
              <PublicThemeToggle label={t("pub.theme.dark")} />
              <LanguageForm locale={locale} t={t} />
            </div>
          </div>
          <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:px-8 sm:pt-[min(14vh,8rem)]">
            <div className={`auth-column w-full ${wide ? "max-w-[38rem]" : "max-w-[27.5rem]"}`}>
              <MessagesProvider locale={locale} messages={pickMessages(messages, namespaces)}>
                {children}
              </MessagesProvider>
            </div>
          </main>
        </div>
      </div>
    </PublicSurface>
  );
}

export default AuthShell;
