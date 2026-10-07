# Phase 22 — Upstream: Frontend Implementation

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 21 — Backend Implementation](./PHASE-21-UPSTREAM-BACKEND.md) · [Phase 23 — Report & PDF Parity](./PHASE-23-UPSTREAM-REPORTS.md) →

| | |
|---|---|
| **Status** | BLOCKED — 10 BLOCKED |
| **Goal** | Pages, PWA field capture with offline mode |
| **Depends on** | Phase 21 |
| **Size** | L |
| **Cards** | 10: P22-01 … P22-10 |
| **Was** | UP-10 (cards UP-10-01 … UP-10-10) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** the pages, with field capture as a PWA with offline mode (UD-14). **Spec refs:** 02 § F
page notes · docs/FRONTEND/00 · docs/UI-UX/08 · ADR-122 · ADR-071/090 · P19-08. **Size:** L.

| Card | Title | Features | Status | Depends on |
|---|---|---|---|---|
| P22-01 | Catalogue and template admin (`dashboard/ipm-templates`) | F-22 | BLOCKED | P21-01 |
| P22-02 | Device form and list: QR, type picker, mandatory photos, condition, thumbnails | F-23 … F-31 | BLOCKED | P21-02 |
| P22-03 | IPM capture: mobile-first stepper, camera QR scan, autosave draft | F-35 … F-53 | BLOCKED | P21-03 |
| P22-04 | IPM history, corrections and void; device "IPM" tab | F-54 … F-57 | BLOCKED | P21-03 |
| P22-05 | Calibration-date quick entry and list | F-62 … F-64 | BLOCKED | P21-05 |
| P22-06 | Exports rendered **in the browser** (PDF and XLSX) from paged reads, with progress and size shown first | F-65 … F-69 | BLOCKED | P21-06 |
| P22-07 | Dashboard condition widgets and technician activity | F-70 … F-73 | BLOCKED | P21-07 |
| P22-08 | Public device page `d/[token]` | F-74, F-75 | BLOCKED | P21-08 |
| P22-09 | Client-facility management and facility-bound users for the tenant administrator; a facility filter (convenience, not a boundary) for provider staff; the facility user's restricted navigation | F-13 … F-17 | BLOCKED | P21-09 |
| P22-10 | PWA offline mode: service worker, IndexedDB queue of drafts and photos, background sync, conflict display | F-78, F-79 | BLOCKED (scope decided, UD-14) | P22-03, P19-08 |

**DoD (adds):** jest, accessibility (light + dark), responsive and live browser suites cover each page;
offline mode proved on a real phone with the network cut and restored (named run in the record).
