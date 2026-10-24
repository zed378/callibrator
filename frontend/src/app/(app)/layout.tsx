/**
 * ADR-131 (P10-18): the root layout of the SIGNED-IN application — the
 * dashboard, and the flows that render in its look (activation, the SSO
 * callback, the OAuth consent screen). It owns <html>/<body> through the shared
 * RootDocument and imports the dashboard's global sheet; the public pages have
 * their own root layout and sheet (app/(public)/layout.tsx). Crossing between
 * the two (sign-in, sign-out) is a full document load.
 */
import type { Metadata } from "next";
import "../globals.css";
import { jetbrainsMono } from "../fonts/mono";
import { inter, spaceGrotesk } from "../fonts/dashboard";
import { ROOT_METADATA, RootDocument } from "../rootDocument";

// The dashboard's faces (Inter, Space Grotesk) are self-hosted in ../fonts/dashboard.ts, unpreloaded
// (P10-13, ADR-131 decision 5).
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
