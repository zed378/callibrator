"use client";
/**
 * P10-17 (ADR-118 §3): the hero's pointer layer. While a fine pointer moves
 * over the hero, it writes the pointer's position (−1 … 1 on each axis) to two
 * CSS variables on its own element; `.lp-pointer` / `.lp-pointer-deep`
 * (landing.css) turn them into a translation of at most 12 px. Decorative
 * layers only — text never follows the cursor.
 *
 * Nothing happens under `prefers-reduced-motion: reduce` or on a coarse
 * pointer (touch), and the variables return to 0 when the pointer leaves.
 * One rAF per frame at most; no state, so React never re-renders.
 */
import React, { useEffect, useRef } from "react";

const clamp = (n: number) => Math.max(-1, Math.min(1, n));

export function HeroPointer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window.matchMedia !== "function") return;
    const allowed = () =>
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
      window.matchMedia("(pointer: fine)").matches;
    if (!allowed()) return;

    let frame = 0;
    let next: [number, number] = [0, 0];
    const write = () => {
      frame = 0;
      el.style.setProperty("--lp-px", next[0].toFixed(3));
      el.style.setProperty("--lp-py", next[1].toFixed(3));
    };
    const schedule = (x: number, y: number) => {
      next = [x, y];
      if (!frame) frame = window.requestAnimationFrame(write);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      schedule(clamp(((e.clientX - r.left) / r.width) * 2 - 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const onLeave = () => schedule(0, 0);

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={className} data-testid="hero-pointer">
      {children}
    </div>
  );
}

export default HeroPointer;
