# Phase 26 — Upstream: UAT With Real Users

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 25 — Reconciliation & Parity Verification](./PHASE-25-UPSTREAM-RECONCILIATION.md) · [Phase 27 — QR Sticker Continuity](./PHASE-27-UPSTREAM-QR-CONTINUITY.md) →

| | |
|---|---|
| **Status** | BLOCKED — 3 BLOCKED |
| **Goal** | Provider technicians in the field, facility admins, IPSRS |
| **Depends on** | Phase 22, Phase 25 |
| **Size** | M |
| **Cards** | 3: P26-01 … P26-03 |
| **Was** | UP-14 (cards UP-14-01 … UP-14-03) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 00 § 1, § 4 · 01 role mapping · Phase 29 guides. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P26-01 | UAT plan and scripts (Indonesian) per persona: provider technician, provider admin, facility admin, facility technician, IPSRS | BLOCKED | Phase 22 |
| P26-02 | Field UAT on phones with poor connectivity, offline capture included, on staging with dry-run data | BLOCKED | P26-01, P25-04 |
| P26-03 | Defect triage and UAT sign-off | BLOCKED | P26-02 |
