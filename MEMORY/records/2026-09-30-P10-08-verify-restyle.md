# 2026-09-30 — P10-08: the verification page on the public surface

**Card:** P10-08 · **ADR:** ADR-098 §2, §10 · **Built on:** A-293 / ADR-100 (the security agent's token + minimal verdict, P10-14) · **Status:** DONE in code

Coordinated with the security agent (a3efccc11dfc4ac2e): its sub-agent finished the logic first (`?t=` → `?token=`, `disclosure: "full" | "minimal"`, the minimal note); this restyle kept every behaviour and added no field to either view.

## Built

- `app/verify/[certificateNumber]/page.tsx` is now a server shell: `generateMetadata` with `robots: { index: false, follow: false }`, the public surface, a header (logo, language form), the `verify.*` strings; the client content moved to `VerifyContent.tsx`. `next.config.ts` also sends `X-Robots-Tag: noindex, nofollow` on `/verify/:path*`.
- The six verdicts the page computes (`verdictOf`): valid, revoked, withdrawn, expired, not found, not yet valid — each a **word in the display serif + an icon + a status colour**, on `--pub-raised` with a 2 px status border. The accent never appears in the card. Not found is neutral (`--pub-neutral`, a question icon) and styled like any other refusal. "Not yet valid" no longer prints the internal status (05 V4): it says the certificate is not yet signed.
- The verdict and the loading state are in `role="status"` / `aria-live="polite"`. Zero motion. Dates formatted in the viewer's language; certificate fields shown as issued; numbers and hashes in the mono face with `break-all`.
- Errors never show the backend's English: 429 → minutes from `retryAfter`; other failures and network → dictionary sentences.

## Evidence

- The four verify suites (`__tests__/page.test.tsx`, `page.f11`, `page.m11`, `page.a293`) pass against `VerifyContent` — their text assertions moved to the dictionary's words (`VALID`, `REVOKED`, `WITHDRAWN`, `NOT FOUND`, the minimal note "Scan the QR code on the certificate for the full details"). 
- Browser, dev build: `/verify/CERT-DEMO-0003?t=<token>` (full, VALID) and `/verify/CERT-NOPE-1` (NOT FOUND) at 320–1920 px, axe 0 at 320 and 1280, one `<h1>`. At 320 px the integrity hashes overflowed (498 px) — fixed (`min-w-0` + `break-all`), re-checked: no element past the viewport. Screenshots `docs/UI-UX/research/screens/p10-verify-*-{320,1280}.webp`.
- `curl -I` of `/verify/x` on the production build carries `X-Robots-Tag: noindex, nofollow` (set in `next.config.ts#headers`).

## Open

- Lighthouse on `/verify/*` (AC-5 ≥ 95, AC-6 LCP ≤ 1.8 s, AC-7 ≤ 120 KB JS) — the page still loads the root layout's shared JavaScript (~176 KB); recorded in the index record.
