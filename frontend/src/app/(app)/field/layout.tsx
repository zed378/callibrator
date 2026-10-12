/**
 * P22-10c2 (P19-08 § 3.1, § 6) — the field app's lean shell: no sidebar, no socket, no dashboard
 * providers. It is the ONLY page that links the web app manifest (so only the field app offers
 * installation) and says it can run full screen on iOS. Rendered per request under the nonce CSP;
 * it reads no tenant data (`fieldShellNoTenantData.guard`).
 */
import React from "react";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Device Calibrator" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
