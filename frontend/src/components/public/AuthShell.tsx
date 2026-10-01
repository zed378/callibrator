/**
 * P10-04 (doc 20 §7.1): the cinematic split-screen every auth page shares —
 * /login, /request-access, /forgot-password, /invitation.
 *
 * Left (≥ 1024 px only): the precision motif, a glimpse of the product and one
 * line of copy. It carries NO claims (the old panel said "HIPAA-ready access
 * controls", research 04 C13) and no heading: the page's single <h1> is in the
 * form column, at every width.
 * Right: back link, language form, then the page's own content in <main>.
 *
 * Server component. The client islands (the forms) are passed in as children,
 * wrapped in a MessagesProvider holding only the namespaces they use.
 */
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicSurface } from "./PublicSurface";
import { PrecisionScale } from "./PrecisionScale";
import { BrandLockup } from "./BrandLockup";
import { LanguageForm } from "./LanguageForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { pickMessages, type Messages, type Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { PRODUCT_SHOTS } from "./landing/productShots";

export function AuthShell({
  locale,
  messages,
  t,
  namespaces,
  wide = false,
  children,
}: {
  locale: Locale;
  messages: Messages;
  t: Translate;
  /** Dictionary prefixes the client forms need, e.g. ["auth."]. */
  namespaces: readonly string[];
  /** The request-access form is longer and wider than sign-in. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const shot = PRODUCT_SHOTS.certificate;
  return (
    <PublicSurface>
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside aria-hidden="true" className="relative hidden overflow-hidden border-r border-pub-border lg:block">
          <div className="pub-light" />
          <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
            <BrandLockup />
            <div>
              <div className="pub-frame max-w-[34rem] opacity-90">
                <Image
                  src={shot.src}
                  width={shot.width}
                  height={shot.height}
                  alt=""
                  sizes="(min-width: 1024px) 34rem, 1px"
                  className="h-auto w-full"
                />
              </div>
              <PrecisionScale className="-mt-6 w-full max-w-[34rem] opacity-80" />
              <p className="pub-display pub-display-m mt-6 max-w-[30rem] text-pub-text">{t("auth.panel.line")}</p>
            </div>
            <p className="pub-caption text-pub-subtle">{t("landing.hero.sampleCaption")}</p>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col bg-pub-surface">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-5 sm:px-8">
            <Link href="/" className="pub-link-quiet text-sm">
              {t("auth.back")}
            </Link>
            <LanguageForm locale={locale} t={t} />
          </div>
          <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-10 sm:items-center sm:px-8">
            <div className={`w-full ${wide ? "max-w-[36rem]" : "max-w-[27.5rem]"}`}>
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
