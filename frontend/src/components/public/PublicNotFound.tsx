/**
 * ADR-131 (P10-18): the 404 on the PUBLIC sheet — rendered by
 * app/global-not-found.tsx (a URL no route matches) and
 * app/(public)/not-found.tsx (a blog or news post that does not exist). The
 * public root layout loads no dashboard CSS, so this is the "Out of tolerance"
 * page of app/(app)/not-found.tsx redrawn with the `--pub-*` tokens: the same
 * concept (the requested reading pinned past the scale's maximum), the same
 * words and the same two ways out. No client JavaScript.
 *
 * Plain <a>, not next/link: a 404 gains nothing from client-side navigation,
 * and "Open dashboard" crosses into the other root layout (a full load) anyway.
 */
import React from "react";
import { ArrowRight, Gauge, Home, LayoutDashboard } from "@/components/icons/static";
import { PublicSurface } from "./PublicSurface";

// Evenly-spaced ruler ticks, as on the dashboard's 404.
const TICKS = Array.from({ length: 21 }, (_, i) => i);

function ToleranceScale() {
  return (
    <figure
      className="mx-auto mt-10 w-full max-w-md select-none"
      aria-label="Tolerance scale showing the requested reading pinned out of range"
    >
      <div className="relative mb-2 h-6">
        <div className="absolute right-[6%] flex -translate-x-1/2 flex-col items-center">
          <span className="pub-mono rounded-md bg-pub-danger px-2 py-0.5 text-[11px] font-bold tracking-wider text-pub-on-accent">
            404
          </span>
        </div>
      </div>

      <div className="relative h-9">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-pub-surface ring-1 ring-pub-border">
          <div className="absolute inset-y-0 left-[28%] right-[28%] bg-pub-verified/70" />
          <div className="absolute inset-y-0 left-0 w-[10%] bg-pub-danger/70" />
          <div className="absolute inset-y-0 right-0 w-[10%] bg-pub-danger/70" />
        </div>

        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[2px]">
          {TICKS.map((t) => (
            <span key={t} className={`w-px ${t % 5 === 0 ? "h-4 bg-pub-border-strong" : "h-2.5 bg-pub-border"}`} />
          ))}
        </div>

        <div className="absolute right-[6%] top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex flex-col items-center">
            <span className="absolute -top-3 h-6 w-0.5 bg-pub-danger" />
            <span className="block h-3.5 w-3.5 rounded-full bg-pub-danger ring-4 ring-pub-danger/20 motion-safe:animate-pulse" />
          </div>
        </div>
      </div>

      <div className="pub-mono mt-2 flex justify-between text-[10px] uppercase tracking-[0.15em] text-pub-subtle">
        <span>min</span>
        <span className="text-pub-verified">in&nbsp;tolerance</span>
        <span>max</span>
      </div>
    </figure>
  );
}

export function PublicNotFound() {
  return (
    <PublicSurface>
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-xl text-center">
          <p className="pub-eyebrow inline-flex items-center gap-3 uppercase tracking-[0.25em]">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-pub-danger" aria-hidden="true" />
            Error 404 · Out of tolerance
          </p>

          <div className="pub-display mt-6 text-[7rem] leading-none tabular-nums text-pub-text sm:text-[9rem]">
            4<span className="text-pub-accent">0</span>4
          </div>

          <ToleranceScale />

          <h1 className="pub-display pub-display-m mt-10 text-pub-text">This page is off the scale.</h1>
          <p className="pub-body-l mx-auto mt-3 max-w-md text-balance text-pub-muted">
            The reading you&apos;re looking for isn&apos;t on our instrument — the page may have been
            recalibrated, moved, or never issued.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate: a 404 needs no client router, and the dashboard is another root layout */}
            <a href="/" className="pub-btn pub-btn-primary">
              <Home className="h-4 w-4" aria-hidden="true" />
              Back to home
              <ArrowRight className="pub-arrow h-4 w-4" aria-hidden="true" />
            </a>
            <a href="/dashboard" className="pub-btn pub-btn-secondary">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              Open dashboard
            </a>
          </div>

          <p className="pub-mono mt-10 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-pub-subtle">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            Device Calibrator
          </p>
        </div>
      </main>
    </PublicSurface>
  );
}

export default PublicNotFound;
