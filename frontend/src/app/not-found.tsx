import React from "react";
import Link from "next/link";
import { ArrowRight, Home, LayoutDashboard, Gauge } from "lucide-react";
import AuroraBackground from "@/components/motion/AuroraBackground";

export const metadata = {
  title: "404 · Out of range — Device Calibrator",
};

// ------------------------------------------------------------------
// Custom 404 — "Out of tolerance".
//
// The concept is calibration-native: the missing page is rendered as an
// instrument reading pinned PAST the maximum on a tolerance scale — the red
// marker sits off the in-tolerance band. Cohesive with the app's Clinical
// Precision system (Space Grotesk display, aurora + blueprint grid, trust-blue
// / health-green / alert-red tokens, tabular numerals). No JS required; the
// single ambient motion (pulsing marker) respects prefers-reduced-motion via
// globals.css.
// ------------------------------------------------------------------

// Evenly-spaced ruler ticks; the ones inside the nominal band read "in range".
const TICKS = Array.from({ length: 21 }, (_, i) => i);

function ToleranceScale() {
  return (
    <figure
      className="mx-auto mt-10 w-full max-w-md select-none"
      aria-label="Tolerance scale showing the requested reading pinned out of range"
    >
      {/* Reading callout, pinned over the out-of-range (right) zone */}
      <div className="relative mb-2 h-6">
        <div className="absolute right-[6%] flex -translate-x-1/2 flex-col items-center">
          <span className="rounded-md bg-destructive px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-destructive-foreground shadow-sm">
            404
          </span>
        </div>
      </div>

      {/* The scale */}
      <div className="relative h-9">
        {/* track */}
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted ring-1 ring-border">
          {/* nominal in-tolerance band (green) */}
          <div className="absolute inset-y-0 left-[28%] right-[28%] bg-success/70" />
          {/* out-of-tolerance zones (red), left + right */}
          <div className="absolute inset-y-0 left-0 w-[10%] bg-destructive/70" />
          <div className="absolute inset-y-0 right-0 w-[10%] bg-destructive/70" />
        </div>

        {/* ticks */}
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[2px]">
          {TICKS.map((t) => (
            <span
              key={t}
              className={`w-px ${t % 5 === 0 ? "h-4 bg-foreground/40" : "h-2.5 bg-foreground/20"}`}
            />
          ))}
        </div>

        {/* the out-of-range marker (needle + hub), pinned past MAX */}
        <div className="absolute right-[6%] top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex flex-col items-center">
            <span className="absolute -top-3 h-6 w-0.5 bg-destructive" />
            <span className="animate-pulse block h-3.5 w-3.5 rounded-full bg-destructive ring-4 ring-destructive/20" />
          </div>
        </div>
      </div>

      {/* axis labels */}
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        <span>min</span>
        <span className="text-success">in&nbsp;tolerance</span>
        <span>max</span>
      </div>
    </figure>
  );
}

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <AuroraBackground />

      <div className="relative z-10 w-full max-w-xl text-center">
        {/* eyebrow */}
        <p className="animate-fade-in-down inline-flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          Error 404 · Out of tolerance
        </p>

        {/* the reading */}
        <div className="animate-fade-in-up mt-6">
          <div className="font-display text-[7rem] font-bold leading-none tracking-tighter text-foreground tabular-nums sm:text-[9rem]">
            4
            <span className="bg-linear-to-br from-primary to-accent bg-clip-text text-transparent">
              0
            </span>
            4
          </div>
        </div>

        <ToleranceScale />

        <h1 className="animate-fade-in-up delay-100 mt-10 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          This page is off the scale.
        </h1>
        <p className="animate-fade-in-up delay-200 mx-auto mt-3 max-w-md text-balance leading-relaxed text-muted-foreground">
          The reading you&apos;re looking for isn&apos;t on our instrument — the
          page may have been recalibrated, moved, or never issued.
        </p>

        {/* actions */}
        <div className="animate-fade-in-up delay-300 mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-primary to-accent px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-primary/40"
          >
            <Home className="h-4 w-4" />
            Back to home
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-5 py-3 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-muted"
          >
            <LayoutDashboard className="h-4 w-4" />
            Open dashboard
          </Link>
        </div>

        {/* footnote */}
        <p className="animate-fade-in delay-500 mt-10 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
          <Gauge className="h-3.5 w-3.5" />
          Device Calibrator
        </p>
      </div>
    </main>
  );
}
