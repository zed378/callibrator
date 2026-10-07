# Phase 15 — Upstream: Module Research

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 14 — DB-Structure Research](./PHASE-14-UPSTREAM-DB-RESEARCH.md) · [Phase 16 — Feature Research](./PHASE-16-UPSTREAM-FEATURE-RESEARCH.md) →

| | |
|---|---|
| **Status** | **DONE 2026-10-07** — 1 DONE |
| **Goal** | Group code into modules, map to ours |
| **Depends on** | Phase 13 |
| **Size** | — |
| **Cards** | 1: P15-01 |
| **Was** | UP-03 (card UP-03-01) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

| Card | Title | Status | Output |
|---|---|---|---|
| P15-01 | 15 modules M01…M15 mapped (Exists 3 · Partial 8 · Missing 2 · N/A 2); draft role map | **DONE 2026-10-07** | 01 |

Evidence and what was **not** run (no `make verify`, no real-data load into PostgreSQL, no EXIF
read, no live-site test) are in the two records.
