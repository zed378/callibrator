import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { NONCE_HEADER, PATHNAME_HEADER } from "@/lib/securityHeaders";
import { getLocale } from "@/i18n/server";
import { htmlLangFor } from "@/i18n/config";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { THEME_INIT_SCRIPT } from "@/lib/themeInitScript";

// Canonical fonts, bundled via next/font (no CDN). Exposed as CSS variables
// referenced by the `--font-sans` / `--font-mono` theme tokens in globals.css.
//
// P10-13 (ADR-098 Amendment 2): Inter and Space Grotesk are the DASHBOARD's
// faces. Declared here (their variables must sit on <html>, which portals and
// the body read), but not preloaded: a preload in the root layout is a preload
// on every page, and the public pages — which use their own two faces
// (fonts/public.ts) — spent ~70 KB of early bandwidth on them, next to the
// landing's LCP image. The dashboard fetches them when its CSS first uses them
// (`display: swap`), then from cache.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  // P10-01 (doc 20 §4.3, 05 §7.2): not preloaded on every page; it loads when
  // a certificate number, serial or code is actually on screen.
  preload: false,
});

// Display face for headings (Clinical Precision direction). Referenced by the
// `--font-display` theme token in globals.css → the `font-display` utility.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

// Pre-hydration theme script (lib/themeInitScript.ts): applies the stored
// light/dark choice, or the device setting when there is none (ADR-122,
// P11-Q4 A), to <html> before first paint, so there is no flash.

export const metadata: Metadata = {
  // Q-43 (ADR-098 §8.1): the public name is "Device Calibrator".
  title: "Device Calibrator",
  description: "Medical device calibration: schedules, records and electronically signed certificates.",
  // Served from frontend/public/. The Next starter's favicon.ico used to sit
  // in this directory and won on the app-dir file convention, so /favicon.ico
  // returned the default icon no matter what this said; apple-touch-icon.png
  // was declared here and 404'd because nothing shipped it.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/brand/app-icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/**
 * P7-08, ADR-071: every page is rendered per request, because a CSP nonce is.
 *
 * Next stamps the proxy's nonce on its scripts only while rendering a request.
 * A prerendered page — or a Cache Components static shell — was rendered at
 * build time with no nonce, and under `'strict-dynamic'` none of its scripts
 * would run. Reading the request headers here, outside any Suspense boundary,
 * makes every route dynamic; `instant = false` declares that this root layout
 * is allowed to block, which is what makes that a valid Cache Components app.
 * `use cache` data caching (lib/content.api.ts) is unaffected.
 */
export const instant = false;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;
  // P10-02 (ADR-098 §4): public pages follow the `locale` cookie (default
  // Indonesian); the dashboard is English until Phase 11 decides.
  const pathname = requestHeaders.get(PATHNAME_HEADER) ?? "";
  const lang = htmlLangFor(pathname, await getLocale());

  return (
    <html
      lang={lang}
      className={`${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <ThemeInitScript script={THEME_INIT_SCRIPT} nonce={nonce} />
        {/*
          P10-13 (ADR-098 Amendment 2): no client providers here. The theme,
          tenant branding, session check and toasts are the signed-in app's
          (app/dashboard/layout.tsx → AppProviders); a provider in the ROOT
          layout is JavaScript every public page downloads and hydrates.
        */}
        {children}
      </body>
    </html>
  );
}
