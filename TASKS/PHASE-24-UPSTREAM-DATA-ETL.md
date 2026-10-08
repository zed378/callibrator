# Phase 24 — Upstream: Data ETL (incl. ~91 GB of Photos)

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 23 — Report & PDF Parity](./PHASE-23-UPSTREAM-REPORTS.md) · [Phase 25 — Reconciliation & Parity Verification](./PHASE-25-UPSTREAM-RECONCILIATION.md) →

| | |
|---|---|
| **Status** | 2 DONE (**P24-06**, the SQL-dump import, and **P24-07**, the rsync image import, 2026-10-07) · 1 TODO (**P24-04**, unblocked 2026-10-08 by P19-05) · 4 BLOCKED |
| **Goal** | Extract → stage → transform → load per client facility of one provider tenant; file pipeline; dry run |
| **Depends on** | Phase 20, Phase 17 |
| **Size** | L |
| **Cards** | 7: P24-01 … P24-07 |
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
| P24-01 | ETL tool `backend/src/scripts/upstream-import/`: extract → stage → transform → load, `upstream_import.id_map` + quarantine (not granted to `callibrator_app`), synthetic fixtures only (**extract → stage is built by P24-06**, ADR-129: what remains is `id_map`, quarantine and the transform — stage 2 — reading `upstream_import.stg_*` by `import_run_id`) | BLOCKED | Phase 20 |
| P24-02 | Transforms in 05 § 3.1 order: the provider tenant and its `client_facilities` (ADR-124), users (invitation; facility staff bound), catalogue, vendors, locations, devices, calibrations, sessions, results, audit rows | BLOCKED — **its decisions are no longer blocking** (UD-4 … UD-13 carried as working decisions 2026-10-08, Phase 12 § 3; UD-7 and UD-8 keep owner facts OA-6, OA-7 for the dry run); it now waits on **P24-01** (the transforms run inside the tool, whose stage 2 waits on Phase 20) | UD-4 … UD-13, **P24-01** (added 2026-10-08) |
| P24-03 | File pipeline for the **device photos only** (its transfer, quarantine, ingest and manifest are built by **P24-07**; what remains: the facility segment by re-keying from the manifest, the attachment rows, derivatives and HEIC → JPEG after P21-02) (~47,080 files, ~91 GB; the ~11.9 k certificate PDFs are archived offline and not loaded — owner rule 2026-10-07, 08-FILE-POLICY; was "~58,650 files, ~110 GB"): content allow-list, ClamAV, SHA-256, put under `t/<tenant>/f/<facility>/attachments/` (ADR-124 § 9), derivatives, HEIC → JPEG; bulk early, delta by name | BLOCKED | P17-05, UD-18 |
| P24-04 | Per-tenant import API key as the calibration-record actor; revoked after cutover — **only for imported records whose upstream user is NULL or deleted**; a resolvable person is `performed_by` (P19-05 spec § 9.2, ADR-133 § 6: scopes `calibration: write`, expiry sign-off + 90 days, revoked at cutover, used through the services by the ETL, never over HTTP) | **TODO** (unblocked 2026-10-08: P19-05 DONE) | P19-05 |
| P24-05 | Dry run: latest dump → throwaway PG 18 + throwaway bucket, every step timed, repeated until P25-01 is green | BLOCKED | P24-01 … 04, UD-7, UD-18 |
| P24-06 | **SQL-dump import** (owner request 2026-10-07): super-admin page `/dashboard/upstream-sql-import` and API `/admin/upstream-sql-imports` — upload a mysqldump / MariaDB dump (plain or gzip, ≤ 200 MB) into the quarantine (content-sniffed, SHA-256, never served, deleted once loaded / cancelled / infected; a failed run's kept 7 days for a retry); a background batch job scans it (ClamAV, fail-closed) and **parses — never executes — it**: only `CREATE TABLE` and `INSERT … VALUES`, everything else counted and discarded; the tables and columns of 07-DATA-MINIMISATION (deny by default) staged into `upstream_import.stg_<table>` (typed, `import_run_id`, `source_row_number`) by the import role `callibrator_import` — `callibrator_app` cannot read the schema; one active run; cancel; retry replaces the run's rows; in-app + e-mail notification with counts only; DPIA gate `UPSTREAM_REAL_DATA_ALLOWED`. **The extract-and-stage half of P24-01** — P24-01 keeps `id_map`, quarantine and the transform (stage 2: designed in ADR-129 § 10, `transformStatus: not_available`) | **DONE 2026-10-07 (stage 1)** — ADR-129 ([record](../MEMORY/records/2026-10-07-sql-dump-import-module.md)); live-checked on PostgreSQL 18 + ClamAV with a synthetic dump only | — (real data: the DPIA gates R-01, R-03, R-17; stage 2: Phase 20) |
| P24-07 | **rsync image import** (owner request 2026-10-07): super-admin page and API `/admin/upstream-file-imports` — check connection (host-key fingerprint confirmed by a person, login, per-class estimate), a background batch job that rsyncs `foto_depan`/`foto_sn` (never the certificate PDFs) into a quarantine, 08-FILE-POLICY's ingest into the tenant's own scope (`t/<tenant>/attachments/`, GPS removed losslessly, ClamAV, SHA-256, read-back verify), a manifest (source path → key + hashes) for P24-03, refused files kept by reason, in-app + e-mail notification with counts; credential KMS-encrypted and erased with the import; DPIA gate `UPSTREAM_REAL_DATA_ALLOWED`. **The transfer and ingest half of P24-03** — P24-03 keeps the facility re-key, derivatives, HEIC and the attachment rows | **DONE 2026-10-07** — ADR-130 ([record](../MEMORY/records/2026-10-07-rsync-image-import-module.md)); live-checked on a throwaway SSH server with synthetic photos only | — (real data: the DPIA gates R-01, R-03, R-17) |

**Abuse cases:** a row "dropped" without a quarantine reason; an append-only target corrected by
UPDATE; a real value in a test fixture.
