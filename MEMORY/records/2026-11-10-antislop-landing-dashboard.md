# 2026-11-10 — antislop audit of the landing page and the dashboard home

**Mode:** antislop `during` (global preference) · **Design Read:** B2B compliance landing for hospital quality staff, and a daily-use dashboard for calibration operators, editorial-warm language (ADR-118, ADR-122), ENERGY 2 / RHYTHM 3 / MOTION 1. · **Follow-up to:** `a8def7f7` (the emoji, sparkle, grid and orb pass).

## Found (rendered at 1440 and 390 px, light theme, dev server on :4010)

The landing page is specific, not generic: serif editorial type, real photographs, one copper accent, an inverted section, honest "sample data" labels. The defects that remained:

| # | Where | Rule | Finding |
|---|---|---|---|
| 1 | landing copy (id, en) | R-02 | 20 em dashes in UI text (titles, captions, the gauge hint, the ISO line) |
| 2 | hero | R-09 | a bordered pill above the H1 holding a greeting |
| 3 | hero | R-03 | the "ISO/IEC 17025 · Multi-fasilitas" line broke mid-word beside the sign-in link |
| 4 | dashboard home | R-05, R-14, R-29 | the default shell: eight equal stat cards in eight hues, each with a tinted icon tile and a gradient top bar |
| 5 | dashboard home | R-16 | a 5xl greeting card with an eyebrow, a scope pill, and a filler sentence ("Here's what's happening across your devices…") |
| 6 | dashboard home | R-01, R-29 | six tinted quick-action tiles, "View Site" in the destructive red |
| 7 | dashboard home | R-02 | "—" as the empty-value mark in three components |
| 8 | dashboard home | R-07, R-13 | `grid-background`, `stat-card`, `quick-action`, `real-time-clock`: unused after `a8def7f7`, still holding a dot grid and three glow orbs |

## Changed

- **Landing:** the 20 dashes are punctuation (`id.ts`, `en.ts`); doc 20 § 11 quotes four of those strings, so its rows were updated to match (`copyTruthfulness.p1011` compares them). The greeting is a plain line; the footnote and the sign-in link stack.
- **Dashboard home:** a compact header. A three-figure band (Compliance Rate, Due in 30 Days, Overdue; colour only when the count is above zero), then the other figures as a ledger. Quick actions are one row of text buttons. Empty values read `n/a`. The loading skeleton matches the new shape. The four dead components and their guard exemptions are gone.

## Evidence

- `jest` over `app/(app)/dashboard`, `app/(public)`, `tests/guards`, `tests/public`: **202 suites, 2,081 tests passed**. The first run failed 4 tests, all real: the `dl` markup failed axe (`a11y` via `axeViolations`, fixed), and `copyTruthfulness.p1011` caught the quoted copy in doc 20.
- `npm run typecheck` 0 errors; `eslint` clean on the changed files.
- Landing: screenshots before and after at 1440 and 390 px; no horizontal overflow on mobile.

## Not done, and why

- **Dashboard not seen rendered.** It needs a signed-in session and the backend; its evidence is the jest and axe suites above, not a click-through (R-35).
- **Product screenshots** on the landing (the six-step story, before/after) are dark-theme, English, with the old blue primary; they sit oddly on a warm Indonesian page. Re-shooting needs the seeded stack. Open.
- **Photographs** in the security and how-we-work bands are visibly soft at 1440 px. Needs higher-resolution licensed sources and `ASSETS.md` rows. Open.
- **Em dashes elsewhere:** 35 more in `id.ts` (IPM report, field app, SQL import, content) and many `"—"` empty cells across other dashboard pages. Not touched; a sweep is its own card.
- **Dashboard copy is English** until Phase 11 decides its language (ADR-098 § 4).
