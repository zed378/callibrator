"use client";
/**
 * P10-17 (ADR-118): the Story's transformation — "binders → one record" as a
 * before/after comparison. A native `<input type="range">` laid over the two
 * images IS the control: keyboard (arrows, Home/End, PageUp/PageDown), touch
 * and pointer all work with no custom key handling, and a screen reader hears
 * its name and value. The "after" layer is clipped with `clip-path` from a CSS
 * variable (no layout, no animation — direct manipulation is not motion, so
 * reduced motion needs no special case).
 */
import React, { useState } from "react";
import Image from "next/image";

export interface BeforeAfterImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  label: string;
}

export function BeforeAfter({
  before,
  after,
  sliderLabel,
  valueText,
  initial = 50,
}: {
  before: BeforeAfterImage;
  after: BeforeAfterImage;
  sliderLabel: string;
  /** "{before}% sebelum, {after}% sesudah" — what the position means, spoken. */
  valueText: string;
  initial?: number;
}) {
  const [pos, setPos] = useState(initial);
  return (
    <figure className="lp-ba" style={{ "--lp-ba": `${pos}%` } as React.CSSProperties}>
      <div className="lp-ba-frame">
        <Image src={before.src} width={before.width} height={before.height} alt={before.alt} sizes="(min-width: 1024px) 760px, 100vw" className="lp-ba-img" />
        <div className="lp-ba-after">
          <Image src={after.src} width={after.width} height={after.height} alt={after.alt} sizes="(min-width: 1024px) 760px, 100vw" className="lp-ba-img" />
        </div>
        <div className="lp-ba-handle" aria-hidden="true">
          <span className="lp-ba-knob" />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={sliderLabel}
          aria-valuetext={valueText.replace("{before}", String(pos)).replace("{after}", String(100 - pos))}
          className="lp-ba-range"
        />
      </div>
      <figcaption className="mt-3 flex justify-between gap-4 text-[0.8125rem] text-pub-subtle">
        <span>{before.label}</span>
        <span className="text-right">{after.label}</span>
      </figcaption>
    </figure>
  );
}

export default BeforeAfter;
