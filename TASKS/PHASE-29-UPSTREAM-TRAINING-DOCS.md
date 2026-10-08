# Phase 29 — Upstream: Training & Documentation in Indonesian

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 28 — Mobile / Offline Decision](./PHASE-28-UPSTREAM-MOBILE-OFFLINE.md) · [Phase 30 — Cutover & Dual-Run](./PHASE-30-UPSTREAM-CUTOVER.md) →

| | |
|---|---|
| **Status** | 1 DONE (P29-02, 2026-10-08) · 3 BLOCKED |
| **Goal** | User guides, "what changed", as-built docs |
| **Depends on** | Phase 26 |
| **Size** | M |
| **Cards** | 4: P29-01 … P29-04 |
| **Was** | UP-17 (cards UP-17-01 … UP-17-04) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 02 F-55, F-56 · UD-6 · docs/ deviation protocol. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P29-01 | User guides (ID): technician (capture, offline, corrections), facility users (what a facility-bound account sees, reports), provider admin (client facilities, binding users), IPSRS (countersign) | BLOCKED | Phase 22 |
| P29-02 | "What changed" note (ID): no overwrite — corrections; invitations; new stickers and public page; the app replaces the APK | **DONE 2026-10-08 (draft, checked against the built screens at UAT P26-01)** — [`docs/UPSTREAM/11-WHAT-CHANGED-ID.md`](../docs/UPSTREAM/11-WHAT-CHANGED-ID.md): one account per person by invitation (no old passwords), who sees what, IPM correction instead of overwrite and void by an administrator, several IPMs per month, reports rendered in the browser, new QR stickers and the public page with the UD-15/16 caveats, the PWA replacing the APK with its offline rules, facility off-boarding (UD-18 (b)); working decisions marked ⚠ — [record](../MEMORY/records/2026-10-08-phase12-18-29-docs.md) | P12-04, P28-02 |
| P29-03 | Short videos / train-the-trainer sessions | BLOCKED | P29-01 |
| P29-04 | As-built `docs/` (English) for the new modules, with their ADRs | BLOCKED | Phase 21, Phase 22 |
