// src/components/layouts/AnimatedBackground.tsx
"use client";

import React from "react";

/**
 * Ambient landing backdrop: a few large, soft, token-tinted blobs drifting
 * slowly behind the page (reusing the orbFloat keyframes in globals.css).
 * Deliberately restrained — low opacity, dimmer in dark mode, and motion stops
 * entirely under `prefers-reduced-motion: reduce` (handled globally in CSS).
 */
export function AnimatedBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* Soft top wash */}
      <div className="absolute -top-24 left-1/2 h-125 w-250 -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />

      {/* Drifting orbs */}
      <div className="absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-primary/10 opacity-70 blur-3xl animate-orb-float-1 dark:opacity-40" />
      <div className="absolute -right-32 top-1/2 h-120 w-120 rounded-full bg-accent/10 opacity-60 blur-3xl animate-orb-float-2 dark:opacity-30" />
      <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-info/10 opacity-50 blur-3xl animate-orb-float-1-reverse dark:opacity-25" />
    </div>
  );
}

export default AnimatedBackground;
