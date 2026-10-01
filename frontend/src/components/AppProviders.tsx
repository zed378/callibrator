"use client";
/**
 * P10-13 (ADR-098 Amendment 2): the signed-in application's client providers —
 * the light/dark theme, the tenant's brand colour, the session check and the
 * toast stack. They used to sit in the ROOT layout, so every public page (the
 * landing, sign-in, verification, blog and news) downloaded and hydrated them,
 * with axios, the auth store and the socket client behind them, and the session
 * check called the backend from pages that have no session. Only the dashboard
 * renders them now (`app/dashboard/layout.tsx`).
 *
 * Order is kept from the root layout it replaces: AuthInitializer is a sibling
 * BEFORE the page, so its effect (the session check) still runs before the
 * dashboard layout's own effects.
 */
import React from "react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TenantBrandingProvider } from "@/components/TenantBrandingProvider";
import { AuthInitializer } from "@/components/AuthInitializer";
import { ToastContainer } from "@/components/ui/ToastContainer";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TenantBrandingProvider>
        <AuthInitializer />
        <ToastContainer />
        {children}
      </TenantBrandingProvider>
    </ThemeProvider>
  );
}

export default AppProviders;
