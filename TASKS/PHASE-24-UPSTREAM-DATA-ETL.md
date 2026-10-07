# Phase 24 — Upstream: Data ETL (incl. ~91 GB of Photos)

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 23 — Report & PDF Parity](./PHASE-23-UPSTREAM-REPORTS.md) · [Phase 25 — Reconciliation & Parity Verification](./PHASE-25-UPSTREAM-RECONCILIATION.md) →

| | |
|---|---|
| **Status** | BLOCKED — 5 BLOCKED |
| **Goal** | Extract → stage → transform → load per client facility of one provider tenant; file pipeline; dry run |
| **Depends on** | Phase 20, Phase 17 |
| **Size** | L |
| **Cards** | 5: P24-01 … P24-05 |
| **Was** | UP-12 (cards UP-12-01 … UP-12-05) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** an idempotent, reconciled import into the provider tenant, per client facility (ADR-124; was "into hospital tenants"). **Spec refs:** 05 (all) · 04 § 2, § 5,
§ 7 · 03 Q-1 … Q-28 · UD-4 … UD-13, UD-18. **Size:** L.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P24-01 | ETL tool `backend/src/scripts/upstream-import/`: extract → stage → transform → load, `upstream_import.id_map` + quarantine (not granted to `callibrator_app`), synthetic fixtures only | BLOCKED | Phase 20 |
| P24-02 | Transforms in 05 § 3.1 order: the provider tenant and its `client_facilities` (ADR-124), users (invitation; facility staff bound), catalogue, vendors, locations, devices, calibrations, sessions, results, audit rows | BLOCKED | UD-4 … UD-13 |
| P24-03 | File pipeline for the **device photos only** (~47,080 files, ~91 GB; the ~11.9 k certificate PDFs are archived offline and not loaded — owner rule 2026-10-07, 08-FILE-POLICY; was "~58,650 files, ~110 GB"): content allow-list, ClamAV, SHA-256, put under `t/<tenant>/f/<facility>/attachments/` (ADR-124 § 9), derivatives, HEIC → JPEG; bulk early, delta by name | BLOCKED | P17-05, UD-18 |
| P24-04 | Per-tenant import API key as the calibration-record actor; revoked after cutover | BLOCKED | P19-05 |
| P24-05 | Dry run: latest dump → throwaway PG 18 + throwaway bucket, every step timed, repeated until P25-01 is green | BLOCKED | P24-01 … 04, UD-7, UD-18 |

**Abuse cases:** a row "dropped" without a quarantine reason; an append-only target corrected by
UPDATE; a real value in a test fixture.
