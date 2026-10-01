/**
 * The public lockup: the mark in white (`currentColor`, never the navy mark,
 * which is 1.12:1 on --pub-bg, doc 20 §4.2) beside the product name.
 */
import React from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";

export function BrandLockup({ name = "Device Calibrator", logoUrl }: { name?: string; logoUrl?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-pub-text">
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
