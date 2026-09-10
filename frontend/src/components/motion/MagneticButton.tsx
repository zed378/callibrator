"use client";

import React, { useRef } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Wraps a CTA (Link / anchor / button) in a magnetic span that eases toward
 * the cursor within ±`strength`px. Preserves the child's semantics (it just
 * translates the wrapper). No-op under reduced motion.
 */
export default function MagneticButton({
  children,
  className,
  strength = 8,
}: {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 180, damping: 15, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 180, damping: 15, mass: 0.4 });
  const reduced = useReducedMotionSafe();

  function handleMove(e: React.MouseEvent) {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const mx = e.clientX - (r.left + r.width / 2);
    const my = e.clientY - (r.top + r.height / 2);
    x.set(clamp(mx * 0.35, -strength, strength));
    y.set(clamp(my * 0.35, -strength, strength));
  }

  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.span
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy, display: "inline-flex" }}
      className={className}
    >
      {children}
    </motion.span>
  );
}
