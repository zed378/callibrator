"use client";
/**
 * P10-17 (ADR-118, doc 20 §6.5 as amended): the verification demo. A sample
 * certificate with its QR code on one side, an auditor's phone on the other.
 * "Scan" plays a 1.1 s scan line, then the phone shows the verdict the real
 * `/verify` page shows for a valid certificate — the same word ("SAH" /
 * "VALID") and the same lead, in the "verified" teal. Under
 * `prefers-reduced-motion: reduce` the verdict appears at once.
 *
 * Everything here is labelled sample data: the QR encodes plain text ("CONTOH
 * DATA — Device Calibrator"), not a link, and no real certificate exists
 * behind it. The verdict is announced in a polite live region.
 */
import React, { useEffect, useRef, useState } from "react";
import { BadgeCheck, ScanLine } from "@/components/icons/static";

export type DemoState = "idle" | "scanning" | "verified";

/** How long the scan line runs before the verdict (matches `lp-scan`). */
export const SCAN_MS = 1100;

export interface QrVerifyDemoLabels {
  scan: string;
  scanning: string;
  again: string;
  idle: string;
  sample: string;
  phoneLabel: string;
  verdict: string;
  verdictLead: string;
  certNumber: string;
  device: string;
  validUntil: string;
}

export interface QrVerifyDemoCertificate {
  number: string;
  device: string;
  validUntil: string;
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function QrVerifyDemo({
  labels,
  certificate,
  qr,
  certificateTitle,
}: {
  labels: QrVerifyDemoLabels;
  certificate: QrVerifyDemoCertificate;
  /** The server-rendered QR code (an SVG). */
  qr: React.ReactNode;
  certificateTitle: string;
}) {
  const [state, setState] = useState<DemoState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onPress = () => {
    if (state === "scanning") return;
    if (state === "verified") {
      setState("idle");
      return;
    }
    if (reducedMotion()) {
      setState("verified");
      return;
    }
    setState("scanning");
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState("verified");
    }, SCAN_MS);
  };

  const rows: Array<[string, string, boolean]> = [
    [labels.certNumber, certificate.number, true],
    [labels.device, certificate.device, false],
    [labels.validUntil, certificate.validUntil, false],
  ];

  return (
    <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
      {/* The paper certificate, with its QR code. */}
      <div className="lp-cert lp-paper relative mx-auto w-full max-w-sm p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-pub-subtle">{certificateTitle}</p>
            <p className="mt-1 break-all text-sm tabular-nums tracking-wide text-pub-text">{certificate.number}</p>
          </div>
          <span className="lp-sample-tag">{labels.sample}</span>
        </div>
        <div className="mt-6 flex items-end justify-between gap-6">
          <div className="space-y-2" aria-hidden="true">
            <div className="h-2 w-28 rounded-full bg-pub-border" />
            <div className="h-2 w-20 rounded-full bg-pub-border" />
            <div className="h-2 w-24 rounded-full bg-pub-border" />
            <div className="mt-4 h-px w-28 bg-pub-border-strong" />
          </div>
          <div className="w-28 shrink-0 rounded-lg border border-pub-border bg-pub-raised p-2">{qr}</div>
        </div>
        <button
          type="button"
          onClick={onPress}
          aria-disabled={state === "scanning" ? true : undefined}
          className="pub-btn pub-btn-primary mt-6 w-full"
        >
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          {state === "verified" ? labels.again : state === "scanning" ? labels.scanning : labels.scan}
        </button>
      </div>

      {/* The auditor's phone. */}
      <figure className="mx-auto" aria-label={labels.phoneLabel}>
        <div className="lp-phone" data-state={state}>
          <div className="lp-phone-screen lp-paper">
            <div className="flex h-full flex-col px-4 pb-5 pt-8">
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-pub-border" aria-hidden="true" />
              {state === "verified" ? (
                <div className="lp-verdict p-4">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="h-7 w-7 text-pub-verified" aria-hidden="true" />
                    <span className="lp-verdict-word">{labels.verdict}</span>
                  </div>
                  <p className="mt-3 text-[0.8125rem] leading-snug text-pub-text">{labels.verdictLead}</p>
                  <dl className="mt-4 space-y-2.5 border-t border-pub-border pt-3">
                    {rows.map(([dt, dd, mono], i) => (
                      <div key={dt} className="lp-verdict-row" style={{ "--lp-i": i } as React.CSSProperties}>
                        <dt className="text-[0.6875rem] font-medium text-pub-subtle">{dt}</dt>
                        <dd className={`text-[0.8125rem] text-pub-text ${mono ? "break-all tabular-nums tracking-wide" : ""}`}>{dd}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <div className="relative flex-1" aria-hidden="true">
                  <div className="lp-viewfinder">
                    <div className="h-full w-full p-3 opacity-25">{qr}</div>
                  </div>
                  <div className="lp-scanline" />
                </div>
              )}
              <p className="mt-auto pt-4 text-center text-[0.75rem] text-pub-subtle">
                {state === "idle" ? labels.idle : labels.sample}
              </p>
            </div>
          </div>
        </div>
      </figure>

      <p role="status" aria-live="polite" className="sr-only">
        {state === "scanning" ? labels.scanning : state === "verified" ? `${labels.verdict}. ${labels.verdictLead}` : ""}
      </p>
    </div>
  );
}

export default QrVerifyDemo;
