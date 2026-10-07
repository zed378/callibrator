# Phase 31 — Upstream: Decommission & Archive

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 30 — Cutover & Dual-Run](./PHASE-30-UPSTREAM-CUTOVER.md) · none — this is the last upstream phase; [Phase 999](./PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md) waits on it →

| | |
|---|---|
| **Status** | BLOCKED — 4 BLOCKED |
| **Goal** | Encrypted archive, drop import schema, revoke, delete copies |
| **Depends on** | Phase 30 |
| **Size** | S |
| **Cards** | 4: P31-01 … P31-04 |
| **Was** | UP-19 (cards UP-19-01 … UP-19-04) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 05 § 8, § 10 · UD-18 · OA-3. **Size:** S.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P31-01 | Encrypted archive of the upstream DB and files for the retention period; one restore tested | BLOCKED | P30-05 |
| P31-02 | Drop `upstream_import`; revoke import keys and upstream credentials; retire the host (keep the redirect only if Phase 27 needs it) | BLOCKED | P31-01 |
| P31-03 | Secure deletion of every copy, `mozivid/` on workstations included; decommission record | BLOCKED | P31-02, OA-3 |
| P31-04 | Phase exit: `PROGRESS.md`, roadmap; Phase 999 unblocked | BLOCKED | P31-03 |
