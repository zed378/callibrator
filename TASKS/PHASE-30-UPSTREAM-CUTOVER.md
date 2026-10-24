# Phase 30 — Upstream: Cutover & Dual-Run

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 29 — Training & Documentation in Indonesian](./PHASE-29-UPSTREAM-TRAINING-DOCS.md) · [Phase 31 — Decommission & Archive](./PHASE-31-UPSTREAM-DECOMMISSION.md) →

| | |
|---|---|
| **Status** | BLOCKED — 4 BLOCKED · **P30-01's runbook written 2026-10-23 (draft)**; the run itself waits on Phase 25 |
| **Goal** | Freeze, final delta, invitations, read-only upstream, go/no-go |
| **Depends on** | Phase 25, Phase 26, Phase 27 |
| **Size** | M |
| **Cards** | 5: P30-01 … P30-05 |
| **Was** | UP-18 (cards UP-18-01 … UP-18-05) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 05 § 8 · ADR-123 deployment · `db-backup`. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P30-01 | Cutover runbook in `TASKS/` (T-14 d … T+30 d, rollback = pre-import backup) | **DRAFT written 2026-10-23** — [`TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`](./RUNBOOK-UPSTREAM-CUTOVER.md): the gate list (legal, pre-invitation, security, reconciliation, UAT, backups), T-14 d … T+30 d with the real `make` targets, the T-0 sequence as decision points, the freeze estimate, the rollback table (the backup, never a delete), and a "what this does not know yet" section. Written ahead of the data on purpose, the way P29-02 was. **The run is P30-02, and it waits on Phase 25** | Phase 25 |
| P30-02 | Full rehearsal on a disposable stack, freeze timed | BLOCKED | P30-01 |
| P30-03 | Go/no-go record: reconciliation signed, UAT signed, security review closed, invitations ready, owner actions done | BLOCKED | P25-04, P26-03, P17-07, P27-04 |
| P30-04 | Cutover: freeze → final dump → delta load and files → reconciliation → invitations; upstream read-only | BLOCKED | P30-03 |
| P30-05 | Dual-run window: upstream read-only for lookup, redirects live, no dual writing; post-cutover reconciliation | BLOCKED | P30-04 |
