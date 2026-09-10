// src/components/auth/AuthBrandingPanel.tsx
"use client";

import React from "react";
import Image from "next/image";
import { BadgeCheck } from "lucide-react";
import { useAuthBrand } from "@/hooks/useAuthBrand";
import { BrandMark } from "./BrandMark";

// Resolved after mount — reading the current year during render is
// non-deterministic and not allowed during prerender in Next 16.
function useCurrentYear() {
  const [year, setYear] = React.useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setYear(new Date().getFullYear()), []);
  return year;
}

const trustPoints = [
  "ISO 17025-aligned workflows",
  "Signed, audit-ready certificates",
  "HIPAA-ready access controls",
];

/**
 * Editorial photographic brand panel for the auth pages. A real photo under a
 * dark + brand-tinted overlay (the tint uses `--primary`, so it recolors for a
 * tenant), with the brand mark, name, tagline and trust points. Desktop-only.
 */
export function AuthBrandingPanel({
  tagline = "Keep every medical device calibrated, compliant, and audit-ready — all from one platform.",
}: {
  tagline?: string;
}) {
  const { name, logoUrl } = useAuthBrand();
  const year = useCurrentYear();

  return (
    <div className="relative hidden w-5/12 shrink-0 overflow-hidden lg:block">
      <Image
        src="/marketing/hero-clinician.jpg"
        alt=""
        fill
        sizes="(min-width: 1024px) 42vw, 0px"
        className="object-cover animate-kenburns"
        loading="eager"
        priority
      />
      {/* Dark base + brand-tinted wash (recolors with the tenant --primary) */}
      <div className="absolute inset-0 bg-slate-950/75" />
      <div className="absolute inset-0 bg-linear-to-tr from-primary/60 via-slate-950/25 to-transparent" />

      <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-12">
        <div className="animate-fade-in-down">
          <BrandMark logoUrl={logoUrl} name={name} size="lg" />
        </div>

        <div className="animate-fade-in-up">
          <p className="inline-flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
            <span
              className="h-px w-8 bg-linear-to-r from-white/80 to-accent"
              aria-hidden="true"
            />
            Calibration, documented
          </p>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-white text-balance xl:text-4xl">
            {name}
          </h1>
          <p className="mt-4 max-w-sm leading-relaxed text-white/80">{tagline}</p>

          <ul className="mt-8 space-y-3">
            {trustPoints.map((t) => (
              <li key={t} className="flex items-center gap-3 text-sm text-white/90">
                <BadgeCheck className="h-5 w-5 shrink-0 text-accent" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/50">
          © {year} {name}. All rights reserved.
        </p>
      </div>
    </div>
  );
}

export default AuthBrandingPanel;
