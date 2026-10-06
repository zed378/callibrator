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

/** One path of unit squares: small markup, crisp at any size. */
export const qrPath = (text: string): { size: number; d: string } => {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const parts: string[] = [];
  for (let y = 0; y < modules.size; y += 1) {
    for (let x = 0; x < modules.size; x += 1) {
      if (modules.get(y, x)) parts.push(`M${x} ${y}h1v1h-1z`);
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
