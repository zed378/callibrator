# Phase 22 — Upstream: Frontend Implementation

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 21 — Backend Implementation](./PHASE-21-UPSTREAM-BACKEND.md) · [Phase 23 — Report & PDF Parity](./PHASE-23-UPSTREAM-REPORTS.md) →

| | |
|---|---|
| **Status** | 3 DONE in code (**P22-02**, 2026-10-10 — live browser suites and a real phone open; **P22-01**, 2026-10-09 — the live browser suites open (its menu entry is on since P21-07, migration 0130); **P22-05**, 2026-10-09 — an optional sidebar entry and the live browser suites open) · 4 TODO (**P22-06** — unblocked by P21-06, 2026-10-09; **P22-03, P22-04** — unblocked by P21-04, 2026-10-09; **P22-07** — unblocked by P21-07, 2026-10-09) · 3 BLOCKED |
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
| P22-01 | Catalogue and template admin (`dashboard/ipm-templates`) | F-22 | **DONE in code** 2026-10-09 ([record](../MEMORY/records/2026-10-09-p22-01-catalogue-admin-ui.md)) — the operator's checklists, draft editor, library, device types and proposal queue; the published catalogue for readers; tenant proposals; `usePermissions().facilityBound` (G-P8). **Open:** the `ipm-templates` menu entry is still inactive (backend: seed + migration, ADR-124 Am. 5); live browser, accessibility (light + dark) and responsive suites not run | P21-01 |
| P22-02 | Device form and list: QR, type picker, mandatory photos, condition, thumbnails | F-23 … F-31 | **DONE in code** 2026-10-10 ([record](../MEMORY/records/2026-10-10-p22-02-device-register-ui.md)) — `dashboard/devices` rebuilt on the generated client: filters (QR, type, condition, due, facility), thumbnails by signed `thumb` link, the form by the two contracts (bound: no QR/status/lab/store/facility; edit sends changes only), the two photos required in the register flow, every photo a ≤ 2,048 px JPEG made in the browser (HEIC converted where the browser decodes it, else explained — ADR-132 Am. 3). **Open:** live browser/a11y/responsive suites, a real phone | P21-02 |
| P22-03 | IPM capture: mobile-first stepper, camera QR scan, autosave draft | F-35 … F-53 | **TODO** (unblocked 2026-10-09: P21-03 drafts + P21-04 submit) | P21-03 |
| P22-04 | IPM history, corrections and void; device "IPM" tab | F-54 … F-57 | **TODO** (unblocked 2026-10-09: P21-04 the correction's submit and the void) | P21-03 |
| P22-05 | Calibration-date quick entry and list | F-62 … F-64 | **DONE in code** 2026-10-09 ([record](../MEMORY/records/2026-10-09-p22-05-calibration-dates-ui.md)) — `dashboard/calibration-dates`: the quick entry by QR sticker (typed or a handheld scanner; the camera is P22-03's) and the calibration list; reached from `/dashboard/calibration`. **Open:** no sidebar entry of its own (backend, optional); live browser, accessibility (light + dark) and responsive suites not run | P21-05 |
| P22-06 | Exports rendered **in the browser** (PDF and XLSX) from paged reads, with progress and size shown first | F-65 … F-69 | **TODO** (unblocked 2026-10-09: P21-06 DONE — `GET /calibration-records` recap parameters, ADR-133 Am. 3) | P21-06 |
| P22-07 | Dashboard condition widgets and technician activity | F-70 … F-73 | TODO (unblocked 2026-10-09 by P21-07 — ADR-126 Am. 6: hide the provider-internal cards for a bound user; `unset` has no drill-down filter) | P21-07 |
| P22-08 | Public device page `d/[token]` | F-74, F-75 | BLOCKED | P21-08 |
| P22-09 | Client-facility management and facility-bound users for the tenant administrator; a facility filter (convenience, not a boundary) for provider staff; the facility user's restricted navigation | F-13 … F-17 | BLOCKED | P21-09 |
| P22-10 | PWA offline mode: service worker, IndexedDB queue of drafts and photos, background sync, conflict display — **specified 2026-10-08 by P19-08** ([spec](../MEMORY/specs/P19-08-offline-field-capture.md); ADR-127 Am. 1: the `/field` one-document app, worker scope `/field`, frozen sync ops, purge rules, AM-23 wipe, real-device script § 16.5). **Planning note (2026-10-08, ADR-134):** build the sync engine (planner, runner, classification, purge) behind the port boundary of [`docs/SHARED/06-SYNC-ENGINE.md`](../docs/SHARED/06-SYNC-ENGINE.md) § 11 — no direct IndexedDB, WebCrypto or `window` calls inside it — so that P35-07 is a move into `@callibrator/sync-engine`, not a refactor | F-78, F-79 | BLOCKED (P19-08 DONE as spec 2026-10-08; still waits on P22-03, and on the server pieces of P19-08 § 9.5 in P21-02/03/09) | P22-03, P19-08 |

**DoD (adds):** jest, accessibility (light + dark), responsive and live browser suites cover each page;
offline mode proved on a real phone with the network cut and restored (named run in the record).
