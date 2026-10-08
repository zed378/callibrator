/**
 * ADR-131 (P10-18): what BOTH root layouts — app/(public)/layout.tsx and
 * app/(app)/layout.tsx — and app/global-not-found.tsx render, written once so
 * the two documents cannot drift:
 *
 *  - the request's CSP nonce on the pre-paint theme script (ADR-071/090: under
 *    `'strict-dynamic'` a script without it never runs, and the page would
 *    flash the wrong theme);
 *  - `lang` from the locale cookie on public paths, English on the dashboard
 *    (P10-02, `htmlLangFor`);
 *  - `suppressHydrationWarning` (the theme script changes <html> before React);
 *  - the site metadata (name, description, icons);
 *  - and NO client providers (ADR-098 Am. 2): a provider here is JavaScript
 *    every page of that group downloads and hydrates.
 *
 * Reading the request headers is also what renders every page per request
 * (P7-08, ADR-071): a prerendered page would carry no nonce. Each layout still
 * declares `export const instant = false` itself — segment configuration is
 * read from the layout file, not from an import — and the guard
 * src/tests/guards/rootLayouts.p1018.guard.test.ts holds all three to this
 * helper and that line.
 */
import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { NONCE_HEADER, PATHNAME_HEADER } from "@/lib/securityHeaders";
import { getLocale } from "@/i18n/server";
import { htmlLangFor } from "@/i18n/config";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { THEME_INIT_SCRIPT } from "@/lib/themeInitScript";

export const ROOT_METADATA: Metadata = {
  // Q-43 (ADR-098 §8.1): the public name is "Device Calibrator".
  title: "Device Calibrator",
  description: "Medical device calibration: schedules, records and electronically signed certificates.",
  // Served from frontend/public/. The Next starter's favicon.ico used to sit
  // in the app directory and won on the app-dir file convention, so
  // /favicon.ico returned the default icon no matter what this said.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/brand/app-icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/** The nonce and the document language of this request. */
export async function readRootRequest(): Promise<{ nonce: string | undefined; lang: string }> {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;
  const pathname = requestHeaders.get(PATHNAME_HEADER) ?? "";
  return { nonce, lang: htmlLangFor(pathname, await getLocale()) };
}

export interface RootDocumentProps {
  /** The `next/font` variable classes this group's sheet reads. */
  fontVariables: string;
  /** The <body> classes (utilities of this group's own sheet). */
  bodyClassName: string;
  children: React.ReactNode;
}

/** The <html>/<body> document of a root layout. */
export async function RootDocument({ fontVariables, bodyClassName, children }: RootDocumentProps) {
  const { nonce, lang } = await readRootRequest();
  return (
    <html
      lang={lang}
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head></head>
      <body className={bodyClassName} suppressHydrationWarning>
        <ThemeInitScript script={THEME_INIT_SCRIPT} nonce={nonce} />
        {children}
      </body>
    </html>
  );
}
