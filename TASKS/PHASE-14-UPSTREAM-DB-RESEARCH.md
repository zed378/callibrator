# Phase 14 — Upstream: DB-Structure Research

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 13 — Code Research](./PHASE-13-UPSTREAM-CODE-RESEARCH.md) · [Phase 15 — Module Research](./PHASE-15-UPSTREAM-MODULE-RESEARCH.md) →

| | |
|---|---|
| **Status** | **DONE 2026-10-07** — 1 DONE |
| **Goal** | Understand schema, data, files |
| **Depends on** | — |
| **Size** | — |
| **Cards** | 1: P14-01 |
| **Was** | UP-02 (card UP-02-01) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

| Card | Title | Status | Output |
|---|---|---|---|
| P14-01 | Upstream database: 52 tables, counts, quality Q-1…Q-28, files, privacy classes; schema mapping and ETL plan (= UP-DB-1) | **DONE 2026-10-07** | 03, 04, 05 · [record](../MEMORY/records/2026-10-07-upstream-database-research.md) |

Evidence and what was **not** run (no `make verify`, no real-data load into PostgreSQL, no EXIF
read, no live-site test) are in the two records.
