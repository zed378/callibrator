# UPSTREAM/ — The Upstream PHP Application (SKP IPM) and Its Adoption

> **Ringkasan (Bahasa Indonesia).** Folder ini berisi riset (2026-10-07) atas aplikasi upstream
> **SKP IPM** — aplikasi CodeIgniter 4 untuk inventaris alat kesehatan dan IPM (Inspeksi dan
> Pemeliharaan Preventif) milik satu penyedia jasa yang melayani 118 faskes — dan rencana
> pemindahannya ke Callibrator. Rencana kerjanya adalah Fase 12 … 31, dengan indeks di
> [`TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md). Tidak ada data
> nyata di dokumen-dokumen ini: hanya struktur, jumlah, dan kode nilai.

**Status:** research, 2026-10-07. These documents describe the **upstream** application, not
Callibrator; nothing here is implemented. Schema names on our side are **proposals** until the
migrations of Phase 20 exist. Source: the owner's local fork in `mozivid/` (gitignored, never
committed). **No real data value, credential or person/facility name appears in any of them.**

| Doc | Content |
|---|---|
| [`00-OVERVIEW.md`](./00-OVERVIEW.md) | What the app is; stack; architecture; auth and groups; routes; mobile API; reports; uploads; **security findings S-01…S-18** (§ 9); **provider vs facility tenancy** (§ 10); drift notes D-01…D-13 (§ 11); the code agent's draft phases |
| [`01-MODULES.md`](./01-MODULES.md) | 15 modules M01…M15 mapped to Callibrator; draft role mapping |
| [`02-FEATURES.md`](./02-FEATURES.md) | 81 features F-01…F-81 with status and implementation notes (table names reconciled to 04) |
| [`03-DATABASE.md`](./03-DATABASE.md) | 52 tables, counts, ER, data quality Q-1…Q-28, files (116 GB), privacy classes |
| [`04-SCHEMA-MAPPING.md`](./04-SCHEMA-MAPPING.md) | **Authoritative for target table names**: tenant mapping, column mapping, code values, users/roles, owner decisions **D-1…D-11** (§ 9), PG 18 sketch proof, proposed migrations, DB phases |
| [`05-DATA-MIGRATION.md`](./05-DATA-MIGRATION.md) | ETL plan: extraction, transforms, id map, passwords, ~110 GB file pipeline, reconciliation R-1…R-12, cutover, UU PDP (file volume and tenancy superseded by 07/08 and the owner's 2026-10-07 corrections) |
| [`06-DPIA.md`](./06-DPIA.md) | **DPIA (P17-02)** under UU PDP 27/2022: inventory, roles (faskes = controller, calibration company = tenant/processor, platform = sub-processor — ⚖ legal review), lawful bases, flows, risks R-01…R-17 (facility scope inside the tenant = R-04), retention, rights, 3 × 24 h breach notice, DPO, consultation |
| [`07-DATA-MINIMISATION.md`](./07-DATA-MINIMISATION.md) | **Minimisation list (P17-04)**: migrate / transform / use-only / not migrated, per table and file class; performer pseudonym; certificate PDFs archive-only and finding **F-CERT** |
| [`08-FILE-POLICY.md`](./08-FILE-POLICY.md) | **File policy (P17-05)**: photos only (~47 k / ~91 GB) — magic-byte allow-list, limits, ClamAV first, SHA-256, `t/<tenant>/f/<faskes>/…` keys, metadata-free derivatives, signed downloads, encryption at rest, verification; certificate PDFs to the offline archive |
| [`09-REPORT-LAYOUTS.md`](./09-REPORT-LAYOUTS.md) | **Report layouts (P23-01)**, structure only: IPM report, inventory PDFs, inventory XLSX, calibration recaps, public page; upstream defects not to copy; targets rendered in the frontend (jsPDF, browser XLSX), paged reads for large exports |
| [`10-OWNER-CHECKLIST.md`](./10-OWNER-CHECKLIST.md) | **Owner checklist (Indonesian)** for OA-1…OA-3: secure the live upstream, check for a past breach, rotate secrets, encrypt and later delete the local copy |

**Plan:** [`../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) —
the index of the 20 phases, Phases 12 … 31 (one file per phase; old `UP-` ids mapped in its § 7), the consolidated owner decisions UD-1…UD-18 and the owner actions OA-1…OA-8.
**Records:** [`2026-10-07-upstream-code-research.md`](../../MEMORY/records/2026-10-07-upstream-code-research.md),
[`2026-10-07-upstream-database-research.md`](../../MEMORY/records/2026-10-07-upstream-database-research.md).
**Backlog:** `TASKS/BACKLOG.md` Q-57.
