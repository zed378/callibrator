import React from "react";
import { MediaFrame } from "@/components/landing/_shared/MediaFrame";
import HeroChips from "./HeroChips";

/**
 * Static hero visual used as the fallback for reduced-motion, no-WebGL, and the
 * pre-hydration / chunk-loading state. Reuses the original clinician photo and
 * the same 4/5 aspect box as the canvas, so swapping to the 3D scene causes no
 * layout shift.
 */
export default function HeroPoster() {
  return (
    <MediaFrame
      src="/marketing/step-calibrate.jpg"
      alt="Close-up of an engineer's hands calibrating a benchtop instrument against a reference standard"
      aspect="4 / 5"
      sizes="(max-width: 1024px) 100vw, 45vw"
      preload
      unoptimized
      className="relative mx-auto max-w-md lg:max-w-none"
      frameClassName="rotate-[0.6deg]"
    >
      <HeroChips />
    </MediaFrame>
  );
}
