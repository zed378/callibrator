"use client";

import React, { useEffect, useRef, useState } from "react";
import { animate, useInView } from "motion/react";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

/**
 * Splits a display string like "12,000+", "40%", or "99.2%" into a prefix,
 * an animatable number (preserving decimals + grouping), and a suffix.
 */
function parseValue(value: string) {
  const m = value.match(/[\d.,]+/);
  if (!m) return { prefix: value, target: 0, suffix: "", decimals: 0, group: false };
  const raw = m[0];
  const idx = m.index ?? 0;
  const cleaned = raw.replace(/,/g, "");
  const dec = cleaned.split(".")[1];
  return {
    prefix: value.slice(0, idx),
    target: parseFloat(cleaned),
    suffix: value.slice(idx + raw.length),
    decimals: dec ? dec.length : 0,
    group: raw.includes(","),
  };
}

function fmt(n: number, decimals: number, group: boolean) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: group,
  });
}

/**
 * Counts a metric up from 0 → target the first time it scrolls into view.
 * Under reduced motion it snaps straight to the final value.
 */
export default function Counter({
  value,
  className,
  duration = 1.2,
}: {
  value: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const reduced = useReducedMotionSafe();
  const { prefix, target, suffix, decimals, group } = parseValue(value);
  const [display, setDisplay] = useState(() => prefix + fmt(0, decimals, group) + suffix);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(prefix + fmt(target, decimals, group) + suffix);
      return;
    }
    const controls = animate(0, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(prefix + fmt(v, decimals, group) + suffix),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
