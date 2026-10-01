/**
 * P10-01 — the precision-scale motif (doc 20 §3 principle 3, §12: drawn in-house,
 * owned). Graduation ticks on an arc, a tolerance band, and a needle that
 * settles inside the band once on load (`.pub-needle`, CSS only; static under
 * reduced motion). Colours come from the public tokens only. Decorative:
 * hidden from assistive technology.
 */
import React from "react";

const CX = 300;
const CY = 300;
const R = 240;
/** The scale spans −60° … +60° around vertical. */
const START = -60;
const END = 60;
/** The tolerance band: −9° … +9°. */
const BAND = 9;

const polar = (deg: number, r: number): [number, number] => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
};

const arc = (from: number, to: number, r: number): string => {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

interface Tick {
  d: string;
  major: boolean;
}

const TICKS: Tick[] = Array.from({ length: (END - START) / 2 + 1 }, (_, i) => {
  const deg = START + i * 2;
  const major = i % 5 === 0;
  const [x1, y1] = polar(deg, R);
  const [x2, y2] = polar(deg, R - (major ? 26 : 13));
  return { d: `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`, major };
});

export function PrecisionScale({ className }: { className?: string }) {
  const [nx, ny] = polar(2, R - 44);
  return (
    <svg
      viewBox="0 0 600 330"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      {/* Outer rule */}
      <path d={arc(START - 4, END + 4, R + 14)} stroke="var(--pub-border)" strokeWidth="1" />
      {/* Tolerance band */}
      <path
        d={arc(-BAND, BAND, R - 8)}
        stroke="var(--pub-accent)"
        strokeOpacity="0.28"
        strokeWidth="16"
        strokeLinecap="butt"
      />
      <path d={arc(-BAND, BAND, R + 6)} stroke="var(--pub-accent)" strokeOpacity="0.7" strokeWidth="1.5" />
      {/* Graduations */}
      {TICKS.map((t, i) => (
        <path
          key={i}
          d={t.d}
          stroke={t.major ? "var(--pub-text-subtle)" : "var(--pub-border-strong)"}
          strokeOpacity={t.major ? 0.9 : 0.55}
          strokeWidth={t.major ? 1.5 : 1}
        />
      ))}
      {/* Needle: pivots at the arc's centre; settles within the band */}
      <g className="pub-needle">
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--pub-accent)" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx={CX} cy={CY} r="7" fill="var(--pub-bg)" stroke="var(--pub-accent)" strokeWidth="2" />
    </svg>
  );
}

export default PrecisionScale;
