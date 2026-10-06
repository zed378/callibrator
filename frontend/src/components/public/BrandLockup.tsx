/**
 * The public lockup: the mark in `currentColor` (charcoal on the warm public
 * surface since P10-17, ADR-118) beside the product name. `.pub-brand` lets
 * the header scale it as the page scrolls.
 */
import React from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";

export function BrandLockup({ name = "Device Calibrator", logoUrl }: { name?: string; logoUrl?: string | null }) {
  return (
    <span className="pub-brand inline-flex items-center gap-2.5 text-pub-text">
      {logoUrl ? (
        // A tenant-pinned build shows the tenant's own logo (doc 20 §7.1).
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin tenant logo of unknown size; next/image would need fixed dimensions and refuses SVG
        <img src={logoUrl} alt="" className="h-8 w-auto max-w-[8rem] object-contain" />
      ) : (
        <BrandIcon className="h-8 w-8 text-pub-text" />
      )}
      <span className="whitespace-nowrap text-[1.0625rem] font-semibold tracking-tight">{name}</span>
    </span>
  );
}

export default BrandLockup;
