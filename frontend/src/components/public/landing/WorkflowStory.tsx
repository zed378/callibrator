"use client";
/**
 * P10-03 (doc 20 §6.3), reworked in P10-17 (ADR-118): the six-step workflow
 * story, the landing's centrepiece. On desktop, the steps on the left with a
 * progress rail, and a sticky product panel on the right that follows the step
 * being read (one IntersectionObserver, CSS `position: sticky`; no
 * scroll-jacking). Each step has its own small, decorative micro-animation in
 * the panel — CSV rows flowing in, the due badge pulsing (three times, then
 * still), a needle settling, a certificate rising, a signature drawing itself,
 * a "verified" stamp — replayed when the step changes (the overlay re-mounts)
 * and static under reduced motion (landing.css).
 *
 * Below 1024 px it is a horizontal, swipeable strip (scroll-snap) of step cards,
 * each with its crop — the brief's "sticky scroll → carousel" fallback. Every
 * step's text is server-rendered and always visible: the observer only chooses
 * which crop the sticky panel shows and how far the rail is filled.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { BadgeCheck, CalendarClock, FileText, PenLine, Upload } from "@/components/icons/static";
import { PrecisionScale } from "@/components/public/PrecisionScale";

export type WorkflowStepId = "device" | "schedule" | "calibrate" | "certificate" | "sign" | "verify";

export interface WorkflowStep {
  id: WorkflowStepId;
  number: string;
  title: string;
  text: string;
  /** The panel's micro-animation label (decorative, aria-hidden). */
  fx: string;
  /** "Langkah 2 dari 6" — the panel's progress text. */
  progress: string;
  image: { src: string; alt: string; width: number; height: number };
}

/** The decorative overlay for one step. Re-mounted (by key) on every change. */
export function StepFx({ id, label }: { id: WorkflowStepId; label: string }) {
  switch (id) {
    case "device":
      return (
        <div className="lp-fx" aria-hidden="true">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-pub-text">
            <Upload className="h-4 w-4 text-pub-accent" />
            {label}
          </p>
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="lp-fx-row" style={{ "--lp-i": i, width: `${92 - i * 14}%` } as React.CSSProperties} />
            ))}
          </div>
        </div>
      );
    case "schedule":
      return (
        <div className="lp-fx" aria-hidden="true">
          <span className="lp-fx-badge">
            <CalendarClock className="h-4 w-4" />
            {label}
          </span>
        </div>
      );
    case "calibrate":
      return (
        <div className="lp-fx w-56" aria-hidden="true">
          <PrecisionScale className="w-full" />
          <p className="-mt-2 text-center text-[0.8125rem] font-semibold text-pub-text">{label}</p>
        </div>
      );
    case "certificate":
      return (
        <div className="lp-fx" aria-hidden="true">
          <div className="lp-fx-card flex items-center gap-3">
            <FileText className="h-8 w-8 text-pub-accent" />
            <div>
              <div className="h-2 w-24 rounded-full bg-pub-border" />
              <p className="mt-2 text-[0.8125rem] font-semibold text-pub-text">{label}</p>
            </div>
          </div>
        </div>
      );
    case "sign":
      return (
        <div className="lp-fx" aria-hidden="true">
          <svg viewBox="0 0 200 60" className="lp-fx-sign h-12 w-48" fill="none">
            <path
              d="M6 42c18-26 30-30 34-16s-8 22 4 14 20-30 30-22-6 24 6 18 18-20 30-16 6 14 18 10 24-8 62-6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="mt-1 flex items-center gap-2 text-[0.8125rem] font-semibold text-pub-text">
            <PenLine className="h-4 w-4 text-pub-accent" />
            {label}
          </p>
        </div>
      );
    case "verify":
      return (
        // Top-right, so the stamp never covers the phone's verdict (QA M4).
        <div className="lp-fx lp-fx-top" aria-hidden="true">
          <span className="lp-fx-stamp">
            <BadgeCheck className="h-5 w-5" />
            {label}
          </span>
        </div>
      );
  }
}

const STRIP_QUERY = "(max-width: 1023.98px)";
const subscribeStrip = (onChange: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(STRIP_QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
};
/** True below 1024 px, where the steps are a horizontally scrolling strip. */
const stripSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(STRIP_QUERY).matches;

export function WorkflowStory({ steps, caption, label }: { steps: WorkflowStep[]; caption: string; label: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const items = refs.current.filter((el): el is HTMLLIElement => Boolean(el));
    if (items.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (Number.isInteger(index)) setActive(index);
          }
        }
      },
      // A step counts as "being read" when it crosses the middle band of the viewport.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Focusable only where it scrolls (axe scrollable-region-focusable), not on desktop.
  const isStrip = useSyncExternalStore(subscribeStrip, stripSnapshot, () => false);
  const current = steps[active] ?? steps[0];
  const progress = steps.length > 0 ? (active + 1) / steps.length : 0;

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <div className="relative min-w-0">
        <div className="lp-rail hidden lg:block" style={{ "--lp-progress": progress } as React.CSSProperties} aria-hidden="true">
          <div className="lp-rail-fill" />
        </div>
        {/* Mobile: a swipeable strip (scroll-snap). Focusable, so the keyboard
            can scroll it too (axe scrollable-region-focusable). */}
        <ol className="lp-steps lg:space-y-[26vh] lg:py-[12vh]" tabIndex={isStrip ? 0 : undefined} aria-label={label}>
          {steps.map((step, i) => (
            <li
              key={step.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-index={i}
              data-active={i === active}
              data-done={i < active}
              className="lp-step"
            >
              <span className="lp-step-dot" aria-hidden="true" />
              <p className="text-sm tabular-nums tracking-wide text-pub-subtle">{step.number}</p>
              <h3 className="pub-display mt-1 text-[1.75rem] leading-tight text-pub-text">{step.title}</h3>
              <p className="mt-3 max-w-md text-pub-muted">{step.text}</p>
              {/* Mobile: the crop sits under its step. */}
              <figure className="lp-panel mt-6 lg:hidden">
                <div className="lp-panel-screen">
                  <Image
                    src={step.image.src}
                    alt={step.image.alt}
                    width={step.image.width}
                    height={step.image.height}
                    sizes="(max-width: 1024px) 150vw, 1px"
                    className={`h-auto w-full ${step.image.width > step.image.height ? "lp-zoom" : ""}`}
                  />
                </div>
              </figure>
            </li>
          ))}
        </ol>
      </div>
      <div className="hidden lg:block">
        <figure className="sticky top-24">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm tabular-nums tracking-wide text-pub-subtle">
              {current.progress}
            </p>
            <ol className="flex gap-1.5" aria-hidden="true">
              {steps.map((s, i) => (
                <li
                  key={s.id}
                  className={`h-1.5 w-6 rounded-full transition-colors ${i <= active ? "bg-pub-accent" : "bg-pub-border"}`}
                />
              ))}
            </ol>
          </div>
          <div className="lp-panel">
            <div className="lp-panel-screen">
              <Image
                key={current.id}
                src={current.image.src}
                alt={current.image.alt}
                width={current.image.width}
                height={current.image.height}
                sizes="(min-width: 1024px) 640px, 1px"
                className="h-auto w-full"
              />
            </div>
            <StepFx key={current.id} id={current.id} label={current.fx} />
          </div>
          <figcaption className="pub-caption mt-3 text-pub-subtle">{caption}</figcaption>
        </figure>
      </div>
    </div>
  );
}

export default WorkflowStory;
