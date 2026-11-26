# Phase 27 — Upstream: QR Sticker Continuity

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 26 — UAT With Real Users](./PHASE-26-UPSTREAM-UAT.md) · [Phase 28 — Mobile / Offline Decision](./PHASE-28-UPSTREAM-MOBILE-OFFLINE.md) →

| | |
|---|---|
| **Status** | P27-03 individual labels and session sheets implemented in working tree, Chromium print verified 2026-11-26; P27-01 fact established 2026-11-25 (bare codes and URLs); P27-02 WIP, implemented and focused checks green, not merged/deployed; P27-04 physical checks excluded by owner. UD-15 decided (ADR-138) |
| **Goal** | Existing stickers keep resolving; new stickers carry a capability token |
| **Depends on** | Phase 19, Phase 22 |
| **Size** | S–M |
| **Cards** | 4: P27-01 … P27-04 |
| **Was** | UP-15 (cards UP-15-01 … UP-15-04) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 02 F-23, F-74 … F-76 · 00 § 9 S-06 · D-13 · UD-15, UD-16. **Size:** S–M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P27-01 | Establish what the stickers encode | Fact established 2026-11-25: owner confirms both bare codes and URLs; production host remains an operator input | OA-4 |
| P27-02 | Legacy resolver: in-app QR lookup for signed-in staff; replaced-sticker notice from the old host (ADR-138 Am. 1 G-2) | WIP 2026-11-25: implemented, focused checks and actual browser login journey green (105/105 suite); not merged/deployed — [record](../MEMORY/records/2026-11-25-p27-02-legacy-stickers.md) | P27-01, UD-16 |
| P27-03 | New stickers with capability tokens: print layout, re-stickering policy | Individual label implemented 2026-10-13 (ADR-138 Am. 4); session-only A4 sheet implemented in working tree 2026-11-25 (Am. 6), 52/52 focused tests — [sheet record](../MEMORY/records/2026-11-25-p27-sticker-sheets.md). Actual Chromium print verified 2026-11-26: 19 labels on two A4 pages, 60 × 40 mm each — [print record](../MEMORY/records/2026-11-26-p27-print-and-frontend-gates.md). Not merged; physical alignment/scans unverified (P27-04 excluded). Production legacy host remains an operator input | P22-08 |
| P27-04 | Sticker-scan test with real phones, legacy and new | Excluded by owner's 2026-11-25 instruction; not verified | P27-02, 03 |
