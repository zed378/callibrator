/**
 * The dashboard's faces, Inter for text and Space Grotesk for headings. They are exposed as the
 * variables `--font-inter` / `--font-space-grotesk`, which `globals.css` reads as `--font-sans` /
 * `--font-display`.
 *
 * 2026-10-24 (flake (b), ADR-131 Am. 1): self-hosted with `next/font/local`, as the public faces
 * (`public.ts`) are. `next/font/google` downloaded the files from Google during `next build`, and
 * the frontend Docker build failed intermittently when that download failed. Nothing is fetched at
 * build or run time now, and the CSP's `font-src 'self'` holds.
 *
 * The files are the latin variable builds of @fontsource-variable 5.x (the subset the Google calls
 * asked for). Inter: wght 100–900, the same variable font `Inter()` served. Space Grotesk: wght
 * 300–700, which covers the 400 / 500 / 600 / 700 the Google call named. Licences (SIL OFL 1.1):
 * `public/licenses/OFL-Inter.txt`, `OFL-SpaceGrotesk.txt`.
 *
 * Neither face is preloaded (P10-13, ADR-131 decision 5): the dashboard paints its shell before its
 * text matters, and `display: swap` covers the wait.
 */
import localFont from "next/font/local";

export const inter = localFont({
  src: [{ path: "./inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const spaceGrotesk = localFont({
  src: [{ path: "./space-grotesk-latin-wght-normal.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-space-grotesk",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
