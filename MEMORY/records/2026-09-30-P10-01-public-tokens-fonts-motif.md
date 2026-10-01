# 2026-09-30 — P10-01: public tokens, self-hosted fonts, the precision motif

**Card:** P10-01 · **ADR:** ADR-098 §3, Amendment 1 rows 1–2 · **Status:** DONE

## Built

- `frontend/src/app/public-surface.css` (imported by `globals.css`): the `--pub-*` tokens of doc 20 §4.2 under `[data-surface="public"]`; Tailwind aliases (`bg-pub-bg`, `text-pub-muted`, …); the type scale (`pub-display-xl/l/m`, `font-synthesis: none`); buttons (6 px, label `--pub-on-accent`, never white); inputs (boundary `--pub-border-strong`); the accent focus ring; links; cards; the hero frame glow capped at `--pub-glow`; one hero light that drifts ≤ 2 % **once** (no loop, so WCAG 2.2.2 needs no control); the needle settle (1.2 s); a skip link; the FAQ marker; forced-colours rules. Every animation sits inside `prefers-reduced-motion: no-preference`. **No dashboard token changed.**
- Fonts: `frontend/src/app/fonts/public.ts` — `next/font/local` over committed `.woff2`: Instrument Serif 400; Plus Jakarta Sans 400/500/600; Latin; 57,348 bytes (budget 90 KB). Licences in `frontend/public/licenses/`. JetBrains Mono no longer preloaded on every page (`app/layout.tsx`, `preload: false`).
- `components/public/PublicSurface.tsx`, `PrecisionScale.tsx` (in-house SVG, tokens only, `aria-hidden`), `public/textures/grain.svg` (in-house `feTurbulence`, a CSS background — no inline `<style>`).
- Asset register rows (doc 20 §12) for both fonts, the grain, and the screenshots.

## Evidence

- `frontend/src/tests/public/publicTokens.contrast.p1001.test.ts` — 14 tests: each text token ≥ 4.5:1 on every surface it sits on; on-accent on accent/hover/pressed; boundaries and focus ≥ 3:1; the three forbidden pairings really fail; inputs use `--pub-border-strong`; **every hex and ratio in doc 20 §4.2 equals what the CSS computes** (37 numeric cells parsed from the doc). **Mutation:** `--pub-text-subtle: #5A6470` → "--pub-text-subtle is text-legible …" and "doc 20 §4.2's hexes and ratios equal what the CSS computes" fail; restored → 14/14.
- Browser (headless Chrome 154, dev server, 2026-09-30, `scratchpad/p10check.cjs`): axe-core 4.13 WCAG 2.1 A/AA **0 violations** — colour contrast included — on `/`, `/login`, `/request-access`, `/forgot-password`, `/invitation`, `/verify/<valid, token>`, `/verify/<not found>` at 320 and 1280 px.
