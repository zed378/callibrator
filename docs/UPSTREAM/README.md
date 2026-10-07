# UPSTREAM/ — The Upstream PHP Application (SKP IPM) and Its Adoption

> **Ringkasan (Bahasa Indonesia).** Folder ini berisi riset (2026-10-07) atas aplikasi upstream
> **SKP IPM** — aplikasi CodeIgniter 4 untuk inventaris alat kesehatan dan IPM (Inspeksi dan
> Pemeliharaan Preventif) milik satu penyedia jasa yang melayani 118 faskes — dan rencana
> pemindahannya ke Callibrator. Rencana kerjanya ada di
> [`TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md`](../../TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md). Tidak ada data
> nyata di dokumen-dokumen ini: hanya struktur, jumlah, dan kode nilai.

**Status:** research, 2026-10-07. These documents describe the **upstream** application, not
Callibrator; nothing here is implemented. Schema names on our side are **proposals** until the
migrations of `UP-08` exist. Source: the owner's local fork in `mozivid/` (gitignored, never
committed). **No real data value, credential or person/facility name appears in any of them.**

| Doc | Content |
|---|---|
| [`00-OVERVIEW.md`](./00-OVERVIEW.md) | What the app is; stack; architecture; auth and groups; routes; mobile API; reports; uploads; **security findings S-01…S-18** (§ 9); **provider vs facility tenancy** (§ 10); drift notes D-01…D-13 (§ 11); the code agent's draft phases |
| [`01-MODULES.md`](./01-MODULES.md) | 15 modules M01…M15 mapped to Callibrator; draft role mapping |
| [`02-FEATURES.md`](./02-FEATURES.md) | 81 features F-01…F-81 with status and implementation notes (table names reconciled to 04) |
| [`03-DATABASE.md`](./03-DATABASE.md) | 52 tables, counts, ER, data quality Q-1…Q-28, files (116 GB), privacy classes |
| [`04-SCHEMA-MAPPING.md`](./04-SCHEMA-MAPPING.md) | **Authoritative for target table names**: tenant mapping, column mapping, code values, users/roles, owner decisions **D-1…D-11** (§ 9), PG 18 sketch proof, proposed migrations, DB phases |
| [`05-DATA-MIGRATION.md`](./05-DATA-MIGRATION.md) | ETL plan: extraction, transforms, id map, passwords, ~110 GB file pipeline, reconciliation R-1…R-12, cutover, UU PDP |

**Plan:** [`../../TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md`](../../TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md) —
20 phases UP-00…UP-19, the consolidated owner decisions UD-1…UD-18 and the owner actions OA-1…OA-8.
**Records:** [`2026-10-07-upstream-code-research.md`](../../MEMORY/records/2026-10-07-upstream-code-research.md),
[`2026-10-07-upstream-database-research.md`](../../MEMORY/records/2026-10-07-upstream-database-research.md).
**Backlog:** `TASKS/BACKLOG.md` Q-57.
