/**
 * P10-01 (ADR-098 §3, doc 20 §4.3): the two public-surface faces, self-hosted
 * from committed `.woff2` files with `next/font/local`. Nothing is fetched from
 * a font CDN at build or run time, so an air-gapped build works and the CSP's
 * `font-src 'self'` holds. Only the public layouts attach these variables
 * (`PublicSurface`); the dashboard keeps Inter and Space Grotesk.
 *
 * Latin subset (Indonesian needs nothing beyond Basic Latin). Licences:
 * `public/licenses/OFL-InstrumentSerif.txt`, `OFL-PlusJakartaSans.txt`.
 * Files from the @fontsource builds of the upstream OFL projects (doc 20 §12).
 */
import localFont from "next/font/local";

/**
 * Display: Instrument Serif Regular. Never below 32 px, never bold. The ONLY
 * preloaded face (P10-17: the hero <h1> is the mobile LCP element, so nothing
 * else competes with it on a slow connection). Five files, 79.5 KB, under doc
 * 20 §4.3's 90 KB.
 */
export const publicDisplayFont = localFont({
  src: [{ path: "./instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" }],
  variable: "--font-pub-display",
  display: "swap",
  preload: true,
  fallback: ["Georgia", "Times New Roman", "serif"],
});

/**
 * P10-17 (ADR-118): Instrument Serif Italic, for the one emphasised phrase per
 * headline (`.lp-em`). Its own variable so it is NOT preloaded: the phrase
 * swaps in from the fallback italic once it arrives.
 */
export const publicDisplayItalicFont = localFont({
  src: [{ path: "./instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" }],
  variable: "--font-pub-display-italic",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "Times New Roman", "serif"],
});

/**
 * Body and UI: Plus Jakarta Sans 400 / 500 / 600. Not preloaded since P10-17
 * (display: swap from a metric-adjusted fallback), so the display face that
 * carries the LCP text is the only font on the critical path.
 */
export const publicBodyFont = localFont({
  src: [
    { path: "./plus-jakarta-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-pub-sans",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
