# Public-page assets — sources and licences

Every image, font and drawing on a public page (landing, sign-in, request access, reset,
invitation, verification, blog, news), with its source, creator and licence. The binding
register is `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` §12 — the P10-11 guard
(`frontend/src/tests/public/copyTruthfulness.p1011.test.ts`) fails the build on any file under
`public/marketing/` or `public/brand/` without a row there. This file is the readable summary.
Keep both in step. `CREDITS.md` keeps the history of what was removed.

Rules (ADR-098, ADR-118): free for commercial use only, and self-hosted, because the CSP allows no
third-party image origin. A photograph is captioned on the page as an illustration ("Foto
ilustrasi" / "Illustrative photo"). Nobody in one is presented as a customer, as our staff, or as
the speaker of a quote. No patient faces, and no real hospital presented as a customer.

## Photographs — Unsplash License

Licence: https://unsplash.com/license. It allows commercial use and modification, and attribution
is not required (we give it anyway). It does not allow selling unaltered copies or compiling the
photos into a competing image service. Every photo was checked on 2026-10-05 as `premium: false`
and `plus: false` through Unsplash's photo API.

| File | Subject | Source | Creator | Used on |
|---|---|---|---|---|
| `people/technician-bench.webp` (1278×1597, 109 KB) | A technician in safety glasses measures a circuit board with a multimeter | https://unsplash.com/photos/a-technician-is-working-on-an-electronic-circuit-M64oBzDDjsY | Arabian Infotech Qatar | auth panel (the landing hero in the first pass) |
| `people/paper-stacks.webp` (1400×933, 78 KB) | Stacks of paper files and folders; no people | https://unsplash.com/photos/stacks-of-paper-documents-and-file-folders-snNHKZ-mGfE | Wesley Tingey | the before/after "before" |
| `people/records-review.webp` (1800×1200, 83 KB) | Two people go through printed documents at a table; cropped at the shoulders | https://unsplash.com/photos/woman-signing-on-white-printer-paper-beside-woman-about-to-touch-the-documents-HJckKnwCXxQ | Gabrielle Henderson | landing compliance |
| `people/clinician-monitor.webp` (1600×1067, 46 KB) | A clinician in scrubs, mask and cap adjusts a vital-signs monitor | https://unsplash.com/photos/a-man-in-scrubs-and-a-stethoscope-looking-at-a-monitor-0Fv4M2hSZJU | César Badilla Miranda | landing hero |
| `people/late-paperwork.webp` (2000×1125, 26 KB) | Two hands, a pen and a fan of printed papers on a dark table in low light; no face | https://unsplash.com/photos/a-woman-sitting-at-a-table-with-lots-of-papers-ZH4FUYiaczY | Dimitri Karastelev | landing story, full bleed |
| `people/device-check.webp` (1120×1400, 19 KB) | A staff member, seen from behind, sets a wall-mounted monitor on a ward | https://unsplash.com/photos/a-person-adjusts-a-medical-monitor-in-a-tiled-room-Scr5C6EGz9I | Alexander Mass | landing "how we work" |

**Removed on 2026-10-05:** `people/hallway-conversation.webp` (Centre for Ageing Better, Unsplash `7FHjL_TJlA8`). It showed identifiable faces and a real UK hospital's uniforms.

## Product screenshots — owned

- **Files:** `product/step-*.webp`. `hero.webp` was deleted, as it is no longer used.
- **Origin:** the product itself.
  - **First capture:** a disposable demo tenant on 2026-09-30 (P10-03).
  - **Re-capture:** 2026-10-05, from the warm build in light theme (P10-17), on the same kind of demo tenant.
- **Data:** invented, with `CONTOH-*` serials. Captioned "Contoh data / Sample data" wherever shown.

## Drawn in-house — owned

- **The precision-scale motif.** An SVG, `components/public/PrecisionScale.tsx`.
- **The demo certificate's QR code.**
  - Drawn on the server from the plain text "CONTOH DATA — Device Calibrator".
  - It uses the `qrcode` npm package (MIT).
- **`public/textures/grain-warm.svg`.** `feTurbulence` noise.

## Product logo — the project's own

- **`public/brand/`** — the mark, lockups and app icon, and the `favicon.ico`,
  `apple-touch-icon.png` and `logo-email.png` rendered from them.
  - Recoloured 2026-10-05 to the warm palette (ADR-118 Amendment 2): charcoal and copper on
    light, ivory and light copper on dark. The shape is the original artwork, unchanged.
  - `lockup-mono.svg` stays monochrome. Origin and designer are still unrecorded (doc 20 §12).

## Fonts — SIL OFL 1.1

- **Instrument Serif, Regular and Italic.**
  - Files: `src/app/fonts/instrument-serif-latin-400-{normal,italic}.woff2`, from @fontsource 5.3.0.
  - Licence text: `public/licenses/OFL-InstrumentSerif.txt`.
- **Plus Jakarta Sans 400/500/600.**
  - Licence text: `public/licenses/OFL-PlusJakartaSans.txt`.

## Assets still needed (owner)

Commissioned photographs of a real, consenting Indonesian hospital team, with model releases:

1. An IPSRS technician calibrating a device. This would replace the hero's electronics workbench.
2. An assessor scanning a printed certificate's QR code with a phone.
3. A quality team preparing for a survey.
4. Optional: a short hero clip, at most 10 seconds, muted, with a pause control.

Real customer stories go in `src/components/public/landing/customerStories.ts`, and only with the
hospital's written permission. The list is empty today on purpose.
