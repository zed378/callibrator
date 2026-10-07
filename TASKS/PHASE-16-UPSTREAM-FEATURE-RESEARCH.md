# Phase 16 — Upstream: Feature Research

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 15 — Module Research](./PHASE-15-UPSTREAM-MODULE-RESEARCH.md) · [Phase 17 — Security, Privacy & Data Protection](./PHASE-17-UPSTREAM-SECURITY-PRIVACY.md) →

| | |
|---|---|
| **Status** | **DONE 2026-10-07** — 1 DONE |
| **Goal** | Feature-level gap list with implementation notes |
| **Depends on** | Phase 15 |
| **Size** | — |
| **Cards** | 1: P16-01 |
| **Was** | UP-04 (card UP-04-01) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

| Card | Title | Status | Output |
|---|---|---|---|
| P16-01 | 81 features F-01…F-81 (Exists 17 · Partial 29 · Missing 30 · N/A 5) with implementation notes; table names reconciled to 04 on 2026-10-07 | **DONE 2026-10-07** | 02 |

Evidence and what was **not** run (no `make verify`, no real-data load into PostgreSQL, no EXIF
read, no live-site test) are in the two records.
