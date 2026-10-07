# Phase 27 — Upstream: QR Sticker Continuity

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 26 — UAT With Real Users](./PHASE-26-UPSTREAM-UAT.md) · [Phase 28 — Mobile / Offline Decision](./PHASE-28-UPSTREAM-MOBILE-OFFLINE.md) →

| | |
|---|---|
| **Status** | BLOCKED on OA-4 (scan a sticker) and UD-15 — 4 BLOCKED |
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
| P27-01 | Establish what the stickers encode | BLOCKED (owner) | OA-4 |
| P27-02 | Legacy resolver: in-app QR lookup for signed-in staff; redirect from the old host if stickers carry URLs (rate-limited, minimal view) | BLOCKED | P27-01, UD-16 |
| P27-03 | New stickers with capability tokens: print layout, re-stickering policy | BLOCKED | P22-08 |
| P27-04 | Sticker-scan test with real phones, legacy and new | BLOCKED | P27-02, 03 |
