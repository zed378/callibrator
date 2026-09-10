"use client";

import { useEffect } from "react";
import { useTenantBranding } from "@/hooks/useTenantBranding";

/** Choose black/white foreground for a hex background based on luminance. */
function readableForeground(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "#ffffff";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  // Perceived luminance (sRGB) — light backgrounds get dark text.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

/** Apply / clear the per-tenant `--primary` brand color on <html>. */
function applyBrandColor(color?: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const valid = color && /^#([0-9a-fA-F]{6})$/.test(color.trim());
  if (valid) {
    root.style.setProperty("--primary", color.trim());
    root.style.setProperty("--primary-foreground", readableForeground(color));
  } else {
    // Revert to the default token values defined in globals.css.
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
  }
}

export function TenantBrandingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { branding } = useTenantBranding();

  useEffect(() => {
    if (!branding) {
      applyBrandColor(undefined);
      return;
    }

    // Apply per-tenant brand color to the theme token.
    applyBrandColor(branding.primaryColor);

    // Update document title
    if (branding.appName) {
      document.title = branding.appName;
    }

    // Create or update favicon links
    const faviconLink = document.querySelector(
      'link[rel="icon"]',
    ) as HTMLLinkElement | null;
    const appleTouchIcon = document.querySelector(
      'link[rel="apple-touch-icon"]',
    ) as HTMLLinkElement | null;

    // Set favicon
    if (branding.favicon) {
      if (faviconLink) {
        faviconLink.href = branding.favicon;
      } else {
        const newLink = document.createElement("link");
        newLink.rel = "icon";
        newLink.href = branding.favicon;
        document.head.appendChild(newLink);
      }
    }

    // Set apple touch icon
    if (branding.logo) {
      if (appleTouchIcon) {
        appleTouchIcon.href = branding.logo;
      } else {
        const newLink = document.createElement("link");
        newLink.rel = "apple-touch-icon";
        newLink.href = branding.logo;
        document.head.appendChild(newLink);
      }
    }
  }, [branding]);

  return <>{children}</>;
}
