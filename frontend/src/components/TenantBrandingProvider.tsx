"use client";

import { useEffect } from "react";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import {
  BRAND_ATTRIBUTE,
  BRAND_PROPERTIES,
  accessibleBrandPalette,
} from "@/lib/brandColor";

/**
 * Apply / clear the per-tenant brand colour on <html>.
 *
 * ADR-090 amendment: the tenant's colour is never written to `--primary`
 * directly. `accessibleBrandPalette` derives one primary per theme that meets
 * the ADR-090 contrast rule there (the brand's hue, its lightness moved only as
 * far as needed), and globals.css picks the light or dark pair under
 * `html[data-tenant-brand]`, so a theme switch needs no script.
 */
export function applyBrandColor(color?: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const palette = accessibleBrandPalette(color);
  // Earlier builds wrote the raw colour here; never leave it behind.
  root.style.removeProperty("--primary");
  root.style.removeProperty("--primary-foreground");
  if (palette) {
    root.style.setProperty(BRAND_PROPERTIES.lightPrimary, palette.light.primary);
    root.style.setProperty(BRAND_PROPERTIES.lightForeground, palette.light.foreground);
    root.style.setProperty(BRAND_PROPERTIES.darkPrimary, palette.dark.primary);
    root.style.setProperty(BRAND_PROPERTIES.darkForeground, palette.dark.foreground);
    root.setAttribute(BRAND_ATTRIBUTE, "");
  } else {
    // Revert to the default token values defined in globals.css.
    for (const name of Object.values(BRAND_PROPERTIES)) root.style.removeProperty(name);
    root.removeAttribute(BRAND_ATTRIBUTE);
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
