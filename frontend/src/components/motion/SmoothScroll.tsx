"use client";

import React, { useEffect } from "react";
import { ReactLenis, useLenis } from "lenis/react";
import { registerGsap } from "./gsap";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

/**
 * Drives Lenis from the GSAP ticker and keeps ScrollTrigger in lockstep, so
 * pinned / scrubbed timelines stay glued to the smoothed scroll position.
 * Lives inside <ReactLenis> so useLenis() resolves the instance.
 */
function GsapLenisSync() {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) return;
    const { gsap, ScrollTrigger } = registerGsap();

    const onScroll = () => ScrollTrigger.update();
    lenis.on("scroll", onScroll);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    ScrollTrigger.refresh();

    return () => {
      lenis.off("scroll", onScroll);
      gsap.ticker.remove(raf);
    };
  }, [lenis]);

  return null;
}

/**
 * Landing-only smooth scroll. Under reduced motion it renders children with
 * native scrolling (no Lenis). `autoRaf:false` hands the RAF loop to GSAP's
 * ticker (see GsapLenisSync) to avoid a double loop.
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotionSafe();

  if (reduced) return <>{children}</>;

  return (
    <ReactLenis root options={{ autoRaf: false, lerp: 0.12, smoothWheel: true }}>
      <GsapLenisSync />
      {children}
    </ReactLenis>
  );
}
