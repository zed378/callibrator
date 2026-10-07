/**
 * P10-17 (ADR-118): the demo certificate's QR code, drawn on the SERVER as an
 * SVG from the `qrcode` encoder (already a dependency, used by the certificate
 * PDF) — no client JavaScript and no image request.
 *
 * It encodes plain text, not a link: a visitor who scans it with a real phone
 * reads "CONTOH DATA — Device Calibrator" (ADR-118, alternatives: there is no
 * public demo certificate for it to open).
 */
import React from "react";
import QRCode from "qrcode";

export const DEMO_QR_TEXT = "CONTOH DATA — Device Calibrator";

/**
 * One path, one rectangle per horizontal run of dark modules: crisp at any
 * size, and the same pixels as a square per module. P10-17 perf addendum: a
 * square per module made the path ~5.8 KB, and the page carries it twice (the
 * HTML and the RSC payload) for each QR on it; runs make it about half that.
 */
export const qrPath = (text: string): { size: number; d: string } => {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const parts: string[] = [];
  for (let y = 0; y < modules.size; y += 1) {
    let x = 0;
    while (x < modules.size) {
      if (!modules.get(y, x)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < modules.size && modules.get(y, x)) x += 1;
      const run = x - start;
      parts.push(`M${start} ${y}h${run}v1h-${run}z`);
    }
  }
  return { size: modules.size, d: parts.join("") };
};

export function DemoQr({ label, text = DEMO_QR_TEXT }: { label: string; text?: string }) {
  const { size, d } = qrPath(text);
  const quiet = 2;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className="lp-qr block h-auto w-full"
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={size + quiet * 2} height={size + quiet * 2} style={{ fill: "var(--pub-raised)" }} />
      <path d={d} fill="var(--pub-text)" />
    </svg>
  );
}

export default DemoQr;
