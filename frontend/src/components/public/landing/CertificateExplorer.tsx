"use client";
/**
 * P10-17 (ADR-118): the explorable certificate — the brief's "personalization"
 * module. A sample certificate (every name on it is invented and the whole
 * document is labelled sample data) with numbered markers, and beside it the
 * explanations of where each part comes from in the product.
 *
 * The explanations are a horizontal scroll-snap track (one per slide, native
 * momentum, the next slide's edge peeking on small screens), kept in sync both
 * ways with the markers and the progress dashes:
 *  - swiping (or scrolling) the track makes the slide in view the active one;
 *  - a marker (pointer, focus or tap) or a dash (a real button) scrolls the
 *    track to its slide — instantly under reduced motion;
 *  - Arrow Left / Right on the focused track move one slide.
 * One polite live region announces the active explanation; the slides carry no
 * live region of their own, so nothing is announced twice.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck } from "@/components/icons/static";

export interface CertificateField {
  label: string;
  value: string;
  /** Index of the hotspot this field belongs to, if any. */
  spot?: number;
}

export interface CertificateSpot {
  title: string;
  text: string;
}

/** One numbered marker: a real button, activated by pointer, focus or tap. */
export function SpotMarker({
  i,
  active,
  label,
  onActivate,
}: {
  i: number;
  active: boolean;
  label: string;
  onActivate: (i: number) => void;
}) {
  return (
    <button
      type="button"
      className="lp-spot"
      aria-pressed={active}
      aria-label={label}
      onClick={() => onActivate(i)}
      onMouseEnter={() => onActivate(i)}
      onFocus={() => onActivate(i)}
    >
      {i + 1}
    </button>
  );
}

/** The slide nearest the track's scroll position (by each slide's offsetLeft). */
export const nearestSlide = (scrollLeft: number, offsets: readonly number[]): number => {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  offsets.forEach((left, i) => {
    const d = Math.abs(left - scrollLeft);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CertificateExplorer({
  docTitle,
  number,
  fields,
  spots,
  qr,
  verified,
  sample,
  spotLabel,
  slideLabels,
  carouselLabel,
}: {
  docTitle: string;
  number: string;
  fields: CertificateField[];
  spots: CertificateSpot[];
  qr: React.ReactNode;
  verified: string;
  sample: string;
  /** "Penanda" — the accessible name prefix of each marker. */
  spotLabel: string;
  /** "Penjelasan 2 dari 4", one per spot — the dashes' names and the slides' labels. */
  slideLabels: string[];
  /** The track's accessible name. */
  carouselLabel: string;
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  // While the track scrolls because WE asked it to, intermediate slides passing
  // by must not become active (and be announced): hold the target until reached.
  const targetRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const releaseRef = useRef(0);

  const current = spots[active] ?? spots[0];

  const goTo = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(spots.length - 1, i));
      setActive(next);
      const track = trackRef.current;
      const slide = slideRefs.current[next];
      if (!track || !slide || typeof track.scrollTo !== "function") return;
      // Already there: no scroll event will come, so hold no target (else every
      // later swipe would be ignored waiting for it).
      if (Math.abs(slide.offsetLeft - track.scrollLeft) < 2) {
        targetRef.current = null;
        return;
      }
      targetRef.current = next;
      // A scroll that is interrupted (a finger on the track) never "arrives":
      // release the hold after the longest smooth scroll.
      if (releaseRef.current) window.clearTimeout(releaseRef.current);
      releaseRef.current = window.setTimeout(() => {
        targetRef.current = null;
        releaseRef.current = 0;
      }, 900);
      track.scrollTo({ left: slide.offsetLeft, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
    [spots.length],
  );

  const onScroll = () => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      const track = trackRef.current;
      if (!track) return;
      const offsets = slideRefs.current.map((el) => el?.offsetLeft ?? 0);
      const index = nearestSlide(track.scrollLeft, offsets);
      if (targetRef.current !== null) {
        if (index !== targetRef.current) return;
        targetRef.current = null;
      }
      setActive((prev) => (prev === index ? prev : index));
    });
  };

  useEffect(
    () => () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      if (releaseRef.current) window.clearTimeout(releaseRef.current);
    },
    [],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(active + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(active - 1);
    }
  };

  const marker = (i: number) => (
    <SpotMarker i={i} active={i === active} label={`${spotLabel} ${i + 1}: ${spots[i]?.title ?? ""}`} onActivate={goTo} />
  );

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-16">
      <div className="lp-doc min-w-0" data-active={active}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-pub-border pb-5">
          <div>
            <p className="pub-display text-[2rem] leading-none text-pub-text">{docTitle}</p>
            <p className="mt-2 break-all text-sm tabular-nums tracking-wide text-pub-muted">{number}</p>
          </div>
          <span className="lp-sample-tag">{sample}</span>
        </div>
        <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {fields.map((f, fi) => (
            <div key={f.label} className={`lp-doc-field ${f.spot !== undefined && f.spot === active ? "is-lit" : ""}`}>
              <dt className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-pub-subtle">
                {f.label}
                {/* One marker per explanation: only the first field it lights carries it. */}
                {f.spot !== undefined && fields.findIndex((g) => g.spot === f.spot) === fi ? marker(f.spot) : null}
              </dt>
              <dd className="mt-1 text-[1.0625rem] text-pub-text">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex items-end justify-between gap-6 border-t border-pub-border pt-5">
          <span className="lp-verified-mark">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {verified}
          </span>
          <div className={`flex items-end gap-2 ${active === spots.length - 1 ? "is-lit" : ""} lp-doc-field`}>
            {marker(spots.length - 1)}
            <div className="w-20 rounded-md border border-pub-border bg-pub-raised p-1.5">{qr}</div>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div
          ref={trackRef}
          className="lp-spot-track"
          role="group"
          aria-roledescription="carousel"
          aria-label={carouselLabel}
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
        >
          {spots.map((s, i) => (
            <div
              key={s.title}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="lp-spot-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={slideLabels[i]}
              data-active={i === active}
            >
              <p className="pub-display text-[3.5rem] leading-none text-pub-accent" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </p>
              <p className="mt-4 text-xl font-semibold text-pub-text">{s.title}</p>
              <p className="mt-3 max-w-md text-pub-muted">{s.text}</p>
            </div>
          ))}
        </div>
        <ol className="mt-6 flex gap-1">
          {spots.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                className="lp-dash"
                aria-label={slideLabels[i]}
                aria-current={i === active ? "step" : undefined}
                onClick={() => goTo(i)}
              >
                <span className={i === active ? "bg-pub-accent" : "bg-pub-border"} />
              </button>
            </li>
          ))}
        </ol>
        <p className="sr-only" aria-live="polite">
          {current ? `${slideLabels[active] ?? ""}: ${current.title}. ${current.text}` : ""}
        </p>
      </div>
    </div>
  );
}

export default CertificateExplorer;
