# Upstream database research — `skp_ipm` structure, quality, mapping and ETL plan

**Date:** 2026-10-07 · **Task:** Upstream PHP Feature Adoption (TASKS/BACKLOG.md Q-57), database
part · **Base commit:** `25521ff` (working tree; nothing committed) · **Decision:** none taken —
eleven owner decisions proposed (D-1 … D-11 in `docs/UPSTREAM/04-SCHEMA-MAPPING.md` § 9)

## What was done

1. Restored the dumps `mozivid/db_dump/2026-10-06-skp_ipm.sql` and `2026-09-01-skp_ipm.sql` into two
   databases of one throwaway container `up-db-mariadb` (`mariadb:10.5`, port bound to
   `127.0.0.1:33606`, random root password generated in the scratchpad, never written to the repo).
   Restore time 8.6 s / 7.8 s. The dump's first line (MariaDB 10.5.29 "sandbox mode" marker) had to
   be stripped for the 10.5 client.
2. Profiled the schema (`information_schema`, the dump's DDL) and the data with **aggregate
   queries only**: row counts per table in both dumps, null ratios, distinct counts, orphan counts
   per implied FK, duplicate natural keys, date ranges and anomalies, hour-of-day histograms,
   encoding patterns, code-value distributions of status columns.
3. Read the CI4 code needed to interpret the data: `app/Controllers/IpmController.php`
   (`ipmSave`, `ipmEditSave`, `kalibrasiSave`), `Apiuser.php` (`upload_foto`),
   `InventoryController.php` (file moves), `app/Config/{App,Database,Routes}.php`,
   `vendor/myth/auth/src/{Password.php,Config/Auth.php}`, `app/Views/ipm/editIPM.php`
   (recommendation code labels).
4. Measured the upload folders of the owner's local copy (`public/uploads/*`) by **listing only**:
   counts, sizes, extensions; compared DB file names with directory listings; SHA-256 over the
   7,248 files that share a size with another, to count byte-identical duplicates. No image or
   document was opened; the two non-media files were classified with `file -b` and a pattern
   count (no content printed).
5. Built a schema **sketch** of the proposed core tables on a throwaway `up-db-pg18`
   (`pgvector/pgvector:pg18`, PostgreSQL 18.6, port bound to `127.0.0.1:55418`) and loaded
   **synthetic data only** (3 tenants, 200 devices, 400 sessions, 2,666 results); ran 8 negative
   and 4 positive checks (results in 04 § 10).
6. Wrote `docs/UPSTREAM/03-DATABASE.md`, `04-SCHEMA-MAPPING.md`, `05-DATA-MIGRATION.md`.

## Findings (aggregates only)

- 52 tables, 0 triggers/routines/views, InnoDB `utf8`; **25 tables have no PRIMARY KEY**; 18
  declared FKs, none on the 16 IPM `trx_*` tables. ~384,500 rows (57.4 MB) on 2026-10-06; +28,910
  rows (+8.1 %) in 35 days.
- No tenant concept: one provider, 118 client facilities; users split into provider staff (`admin`
  10, `user` 35) and facility staff (`client` 57, `teknisi_client` 3), each facility user mapped to
  exactly one facility; isolation only in PHP.
- 23,722 devices identified by a QR code (unique); 8,166 inspection sessions with no header table
  (key = QR + date; edits delete and re-insert); 3,640 calibration dates; 11,851 certificate PDFs.
- Data quality: 13,169 IPM rows and 2,294 devices reference deleted users; 624 duplicate-serial
  groups inside facilities; 4,073 result rows reference deleted checklist items; performance rows
  have no item id at all; 16 duplicate session headers; future and implausible dates; decimal
  commas; no encoding damage.
- Timestamps: config says `Asia/Jakarta`, but the IPM hour-of-day histogram looks like WIB working
  hours stored as UTC (logins do not) — left as owner decision D-6.
- Passwords: `myth/auth` = bcrypt cost 10 over base64(SHA-384(password)), all `$2y$10$`; ours =
  bcrypt cost 12 over the password → recommend invitation, not hash import.
- Files: 62,021 files / 116.1 GB in `public/uploads` (JPEG 95.4 GB, PDF 19.1 GB, HEIC 897 files);
  162 referenced-but-missing, 3,360 unreferenced; 3,293 redundant byte-identical copies (≤ 6.2 GB);
  one shell script and one text file in the public certificate folder (must not be migrated);
  ~3,600 files keep client original names.

## Evidence

- Restores, queries and sketch checks were run interactively in this session; the sketch's
  results are listed constraint-by-constraint in `docs/UPSTREAM/04-SCHEMA-MAPPING.md` § 10 (each
  refusal named by its constraint).
- **Not run:** `make verify` (no code changed), any Sequelize model or migration, any load of real
  data into PostgreSQL, ClamAV/derivative throughput, EXIF content of photos.

## Privacy

No real value (name, e-mail, hash, token, phone, address, serial, facility name, free text, file
name) was written to any repository file, document or this record. Code values only
(`Baik`/`Tidak Baik`/`Laik`/`Rusak`, `Ada`/`Tidak`, `1/0/-1/-2`, group names). Intermediate files
(DDL extract, file-name lists for reconciliation, sketch SQL, passwords) lived in the session
scratchpad and were deleted.

## Clean-up

Removed by name: containers `up-db-mariadb` and `up-db-pg18`, their two anonymous volumes (by id,
read from `docker inspect` before removal), and the `mariadb:10.5` image this research pulled. No
network was created. No prune was run. `pgvector/pgvector:pg18` was already present and was kept.
Nothing under `mozivid/` was modified.

## Not done / handed on

- The DB phase list UP-DB-1 … UP-DB-9 (04 § 12) for the coordinator to merge with the code agent's
  phases; the owner decisions D-1 … D-11; ADRs for the tenant model / `service_engagements` and
  the global catalogue.
- `TASKS/PROGRESS.md`, `MEMORY-INDEX`, `CHANGELOG` were not edited by this agent (coordinator's
  merge).
