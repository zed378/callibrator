# Phase 23 — Upstream: Report & PDF Parity

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 22 — Frontend Implementation](./PHASE-22-UPSTREAM-FRONTEND.md) · [Phase 24 — Data ETL (incl. ~91 GB of Photos)](./PHASE-24-UPSTREAM-DATA-ETL.md) →

| | |
|---|---|
| **Status** | 1 DONE / BLOCKED (4) — 1 DONE · 4 BLOCKED |
| **Goal** | IPM report, inventory PDF/XLSX, 5 calibration recaps: field parity plus our numbering, QR verification, signatures |
| **Depends on** | Phase 21 |
| **Size** | M |
| **Cards** | 5: P23-01 … P23-05 |
| **Was** | UP-11 (cards UP-11-01 … UP-11-05) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** every upstream document has a field-for-field equivalent, plus our numbering, QR
verification and signatures. **Spec refs:** 00 § 7 · 02 F-58 … F-69 · M08, M10 · P19-06. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P23-01 | Structure-only reference of the upstream layouts (sections, field order, page size, signature blocks) from the views — no data | **DONE 2026-10-07** — `docs/UPSTREAM/09-REPORT-LAYOUTS.md` (targets: frontend jsPDF / client-side XLSX, no stored files); [record](../MEMORY/records/2026-10-07-upstream-privacy-and-reports.md) | — |
| P23-02 | IPM report as a frontend renderer (ADR-126 § 8; no stored PDF); golden-file test on synthetic data — **specified 2026-10-08 by P19-06** ([spec](../MEMORY/specs/P19-06-ipm-report-document.md) § 9 – § 12, § 16; ADR-126 Am. 2): `lib/pdf/` shared primitives, `lib/ipmReportPdf.ts`, the on-screen report page, the signature dialog, `/verify/ipm/[reportNumber]` (≤ 120 KB brotli) | BLOCKED (P19-06 DONE as spec 2026-10-08; still waits on P21-03 and P21-04 — the document and signature routes) | P21-03, P21-04, P19-06 |
| P23-03 | Inventory PDF (with/without photos) and the facility variant | BLOCKED | P21-06 |
| P23-04 | Inventory XLSX and the five calibration recaps: column parity | BLOCKED | P21-06 |
| P23-05 | Side-by-side sign-off by the provider (dry-run data on a throwaway stack) | BLOCKED | P23-02 … 04, P24-05 |
