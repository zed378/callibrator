# P27-03: the device sticker's final layout (60 × 40 mm, made in the browser) and the re-stickering policy

**Date:** 2026-10-13 · **Task:** P27-03 (Phase 27), line B of the 2026-10-13 batch, card 2 · **Decision:** [ADR-138 Amendment 4](../DECISIONS.md) · **Spec refs:** ADR-138 (+ Am. 1–3), [`specs/P19-07-public-device-page.md`](../specs/P19-07-public-device-page.md) § 10, [P22-08 record](./2026-10-13-p22-08-public-device-page.md) · **Base:** `36bda3b` + card 1 (contrast)

> Frontend only; no backend file, no migration, no route. No stored file (owner rule). `mozivid/` not touched. Synthetic data only in tests.

## Built

| What | Where |
|---|---|
| **The layout module** | `frontend/src/app/(app)/dashboard/devices/components/stickerLayout.ts` — the label's millimetres (60 × 40, QR 33, pad 2.5, gap 2), the bilingual caption, `issueDay`, `footerLine`, a word wrap with a three-line cut, `drawLabel` (pure over a 2-D context: paper, the QR module by module, the text column) and `stickerPng` (300 dpi canvas → PNG data URL; `null` without a QR matrix or a canvas) |
| **The label** | `components/StickerLabel.tsx` — the same layout in HTML (`w-[60mm] h-[40mm]`), paper and ink from the new `label-*` tokens, `lang="id"` / `lang="en"` on the two caption lines |
| **The dialog** | `components/PublicLinkDialog.tsx` — the sticker section shows the label (and the link, on screen only, for copying); **Print** renders the label into `<body>` as `.sticker-print-root` (via `flushSync` + a portal) only while `window.print()` runs; **Download** is the label PNG (the plain QR without a canvas); a **"When to replace a sticker"** disclosure states the policy |
| **Print stylesheet + tokens** | `frontend/src/app/globals.css` — `--label-paper` / `--label-ink` (`:root` only, not flipped by `.dark`) and their `--color-*` mappings; `@page sticker-label { size: 60mm 40mm; margin: 0 }`; under `body.sticker-print` every other child of `<body>` is `display: none` and the root is laid on that named page. The P22-08 `visibility` rules are replaced |
| **Messages** | `src/i18n/messages/en.ts`, `id.ts` — `devices.sticker.policy.*` (7 keys each, ID and EN). The label's caption is fixed text in both languages (ADR-138 Am. 4 § 2), not a per-locale message |

## The re-stickering policy (as shown in the panel)

Replace the link and print a new sticker when the sticker is damaged, unreadable or lost, or its link may have been shared beyond the device. Keep it when the device moves room or facility or its calibration changes, and on a retired device (its page says so). Deleting a device revokes its link; reinstating does not bring it back. Remove the old sticker when applying a new one (a replaced link shows "not found"). A device carrying only a legacy sticker gets a new one at its next visit.

## Left open, recorded

| Item | Why open | Where |
|---|---|---|
| What legacy stickers encode, and so which legacy branch applies | owner fact **OA-4**, decision **UD-16** | P27-01, P27-02 (BLOCKED) |
| A sheet of many labels for a re-stickering campaign (batch issue) | a batch would mint many tokens in one act; worth designing with the campaign's numbers (dry-run sticker count) | follow-up, with P27-04 |
| The staff app's QR lookup reading a `/d/<token>` link from a new sticker | needs a staff route that resolves a token in the caller's context (backend) | P27-02's scanner entry; staff type the printed QR number meanwhile |
| Real-phone scans of the printed label | P27-04 (BLOCKED on P27-02) | P27-04 |

## Tests

`frontend/src/app/(app)/dashboard/devices/__tests__/sticker.p2703.test.tsx` — 12 cases: the label's size in mm and px; `issueDay`; `footerLine`; `wrap` (words, cut words, ellipsis, empty); `drawLabel` inks exactly the dark modules inside the QR's square and nothing outside the quiet zone; the caption, name (three lines, "…") and footer are right of the QR and never contain the token; `stickerPng` (a PNG with a canvas, `null` without one or without a matrix); in the dialog: the label's content and the label PNG as the download (axe clean); the plain QR without a canvas; Print puts exactly one `.sticker-print-root` with the label directly under `<body>` during `window.print()` and removes it after; the policy in English; Indonesian. The P22-08 suite `publicLink.p2208.test.tsx` passes unchanged (11 cases).

## Gates (2026-10-13)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on the changed `.ts`/`.tsx` files | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests` (the dialog, the label, the layout module, `en.ts`, `id.ts`, `globals.css`) | 61 suites, 593 tests passed |
| `npx jest --ci src/tests/guards` | 7 suites, 115 tests passed |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | exit 0; every route within |
| **`automate/p22.browser.mts`** on a disposable stack (frontend rebuilt with this card) | **102/102** — P22-08's flow: issue → the dialog with the new label and policy axe-clean (light), the public page signed out, revoke, the refusal page |
| **Print check** (a throwaway script in the session's scratchpad, not committed): the stack's built dashboard stylesheet (the chunk holding `@page sticker-label`), a body with an app child and a `.sticker-print-root` label, `sticker-print` on `<body>`, Chrome `page.pdf({ preferCSSPageSize: true })` | the label lays out at 226.8 × 151.2 CSS px (60 × 40 mm); the app child is `display: none`; the label paper is white; the PDF has **1 page of 59.9 × 39.9 mm** (MediaBox, pt rounding) |

**Stack:** `deploy/compose` (`docker-compose.yml` + `.build.yml` + `.e2e.yml`), project `lineb-stack`, `BUILD_TAG=lineb`, `BUILD_CONTEXT` = a clean worktree of `36bda3b` + the contrast card + this card (line A's tree left out), production mode, 127.0.0.1:27510 / 27511 / 27512. Torn down with `down -v --rmi local`; the worktree removed.

**Not covered here:** the canvas PNG in a real browser (unit-tested against a recording context; the canvas itself was not opened in Chrome), a physical label printer, and phones (P27-04).
