/**
 * ADR-131 (P10-18): JetBrains Mono, the one face BOTH root layouts declare —
 * certificate numbers, serials and codes on the dashboard, and `.pub-mono` /
 * article code on the public surface. It was declared in the single root
 * layout; with two root layouts it is declared once here and attached by each.
 *
 * P10-01 (doc 20 §4.3, 05 §7.2): not preloaded on any page; it loads when a
 * certificate number, serial or code is actually on screen.
 *
 * 2026-10-24 (flake (b), ADR-131 Am. 1): self-hosted with `next/font/local`, as the public faces
 * are. `next/font/google` fetched the file from Google at BUILD time, and the frontend image build
 * failed intermittently when that fetch failed. The file is the latin variable (wght 100–800)
 * build from @fontsource-variable/jetbrains-mono 5.3.0; licence
 * `public/licenses/OFL-JetBrainsMono.txt` (SIL OFL 1.1).
 */
import localFont from "next/font/local";

export const jetbrainsMono = localFont({
  src: [{ path: "./jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-jetbrains",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});
