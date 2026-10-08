/**
 * ADR-131 (P10-18): the root layout of the SIGNED-IN application — the
 * dashboard, and the flows that render in its look (activation, the SSO
 * callback, the OAuth consent screen). It owns <html>/<body> through the shared
 * RootDocument and imports the dashboard's global sheet; the public pages have
 * their own root layout and sheet (app/(public)/layout.tsx). Crossing between
 * the two (sign-in, sign-out) is a full document load.
 */
import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "../globals.css";
import { jetbrainsMono } from "../fonts/mono";
import { ROOT_METADATA, RootDocument } from "../rootDocument";

// The dashboard's faces (Inter for text, Space Grotesk for headings), exposed
// as the variables `--font-sans` / `--font-display` read in globals.css.
//
// P10-13 (ADR-098 Amendment 2) set `preload: false` on both, because the one
// root layout preloaded them on every PUBLIC page. ADR-131 decision 5: they are
// declared only here now, so that reason is gone; they stay unpreloaded until a
// measurement on the dashboard says otherwise (the dashboard paints its shell
// before its text matters, and `display: swap` covers the wait).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = ROOT_METADATA;

/** P7-08, ADR-071: rendered per request (the CSP nonce); see app/rootDocument.tsx. */
export const instant = false;

export default function AppRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <RootDocument
      fontVariables={`${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable}`}
      bodyClassName="min-h-full flex flex-col bg-background text-foreground"
    >
      {children}
    </RootDocument>
  );
}
