# Phase 13 — Upstream: Code Research

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 12 — Decisions & ADRs](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) · [Phase 14 — DB-Structure Research](./PHASE-14-UPSTREAM-DB-RESEARCH.md) →

| | |
|---|---|
| **Status** | **DONE 2026-10-07** — 1 DONE |
| **Goal** | Understand the upstream code |
| **Depends on** | — |
| **Size** | — |
| **Cards** | 1: P13-01 |
| **Was** | UP-01 (card UP-01-01) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

| Card | Title | Status | Output |
|---|---|---|---|
| P13-01 | Upstream code: stack, routes, auth, API, reports, uploads, security S-01…S-18, drift D-01…D-13 | **DONE 2026-10-07** | 00 · [record](../MEMORY/records/2026-10-07-upstream-code-research.md) |

Evidence and what was **not** run (no `make verify`, no real-data load into PostgreSQL, no EXIF
read, no live-site test) are in the two records.
