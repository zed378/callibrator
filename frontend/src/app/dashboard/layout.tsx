/**
 * P10-13 (ADR-098 Amendment 2): the signed-in application's providers, moved
 * here from the root layout so the public pages do not load them. Nothing
 * else about the dashboard changes: each page still renders its own
 * DashboardLayout (sidebar, top bar) inside this.
 */
import React from "react";
import { AppProviders } from "@/components/AppProviders";

export default function DashboardRootLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
