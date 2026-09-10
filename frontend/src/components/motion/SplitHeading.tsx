"use client";

import React, { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { registerGsap } from "./gsap";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

/**
 * Heading with a scroll-triggered reveal. When `children` is a plain string it
 * uses GSAP SplitText for a word-by-word mask wipe (lines get `.split-line`,
 * which clips them). When it contains elements (e.g. an <Underline/>) it falls
 * back to a safe whole-element fade-up so nested markup is never mangled.
 * No animation runs under reduced motion.
 */
export default function SplitHeading({
  children,
  as = "h2",
  className,
}: {
  children: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotionSafe();
  const isPlain = typeof children === "string";

  useGSAP(
    () => {
      const el = ref.current;
      if (reduced || !el) return;
      const { gsap, SplitText } = registerGsap();

      if (isPlain) {
        const split = new SplitText(el, { type: "words,lines", linesClass: "split-line" });
        gsap.from(split.words, {
          yPercent: 120,
          opacity: 0,
          duration: 0.8,
          ease: "expo.out",
          stagger: 0.025,
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
        });
        return () => split.revert();
      }

      gsap.from(el, {
        y: 28,
        opacity: 0,
        duration: 0.7,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 85%", once: true },
      });
    },
    { scope: ref, dependencies: [reduced, isPlain] },
  );

  return React.createElement(as, { ref, className }, children);
}
