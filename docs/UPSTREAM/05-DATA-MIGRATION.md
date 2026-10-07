# 05 — Data Migration (ETL) Plan: `skp_ipm` → Callibrator (PROPOSAL)

> **Ringkasan (Bahasa Indonesia).** Rencana memindahkan data nyata upstream ke skema kita
> (04-SCHEMA-MAPPING). Volume: ±384 ribu baris database (±57 MB) — dimuat dalam hitungan **menit**;
> berkas unggahan **62.021 file / 116 GB** — yang menentukan durasi (**±1–4 jam** tergantung jaringan
> dan pemindaian antivirus). Hash kata sandi **tidak** diimpor (algoritme myth/auth = bcrypt atas
> SHA-384 — bisa diverifikasi, tetapi kami sarankan undangan reset). ETL bersifat idempoten
> (tabel `upstream_import.id_map`), selalu didahului *dry-run* di PostgreSQL 18 sekali pakai, dengan
> rekonsiliasi per tenant, rollback lewat backup, dan cutover dengan masa *freeze*. Privasi: UU PDP
> (UU 27/2022) — minimisasi (log login, IP, sesi, log aplikasi tidak dipindah), perjanjian pemrosesan
> data, retensi dan pemusnahan salinan upstream.

**Status: PROPOSAL, 2026-10-07 — no ETL code exists.** Source facts: [`03-DATABASE.md`](./03-DATABASE.md);
target: [`04-SCHEMA-MAPPING.md`](./04-SCHEMA-MAPPING.md) (decisions D-1 … D-11 there). Volumes and
timings are measured where stated, estimated (and labelled) otherwise.

---

## 1. Principles

1. **Set-based, staged, repeatable.** Extract into a staging schema on PostgreSQL, transform with
   SQL, load with `INSERT … SELECT`. No row-by-row ORM loop (the Sequelize hooks are not the
   integrity mechanism of an import; the constraints and the reconciliation are).
2. **Every row is accounted for**: loaded (and in `id_map`), merged (and in `id_map` pointing at
   the survivor), or **quarantined with a reason**. "Dropped silently" does not exist.
3. **Never mutate the source.** The ETL reads a dump or a read-only replica.
4. **Dry run before real run, always** — `calibration_records` and (proposed) submitted inspection
   results are append-only; a wrong real load is corrected only by voiding.
5. **No real data in the repository** — fixtures are synthetic; reports are aggregates; logs carry
   ids and counts, never values.

## 2. Extraction

| Source | How | Notes |
|---|---|---|
| Daily dump (`mozivid/db_dump/*.sql`, `mysqldump`) — **recommended** | restore into a throwaway `mariadb:10.5` (measured: 43 MB dump → **8.6 s**), then export each table to CSV/TSV (`SELECT … INTO OUTFILE` or `mariadb --batch`) or read it directly with a MySQL client from the ETL | strip the dump's first line (10.5.29 "sandbox" marker) for a 10.5 client; restore with `--default-character-set=utf8mb4` |
| Live MariaDB | a read-only user on a replica, `REPEATABLE READ` snapshot (`START TRANSACTION WITH CONSISTENT SNAPSHOT`) | only for the final delta, to shorten the freeze |
| Files | `rsync`/`rclone` from the upstream host's `public/uploads/{foto_depan,foto_sn,inventory}` (or the owner's local copy in `mozivid/…/public/uploads`) to a staging bucket | read-only; checksummed at source |

Staging: `upstream_stage.<table>` on the target PostgreSQL 18 (or a separate throwaway PG during
the dry run), all columns as `text` first, then cast in the transform — so a bad value fails a
transform step with a row id, not the bulk load.

## 3. Transform Rules

### 3.1 Order (dependencies)

```
1  tenants            ← mst_faskes               (+ the provider tenant)
2  users              ← users × auth_groups_users × trx_mapping_user_client
3  device_types       ← mst_alat                  (dedupe 5 case groups)
4  inspection_item_definitions ← 12 mst_* tables
5  device_type_inspection_items ← 5 mapping_*     (collapse 5 duplicate pairs)
6  vendors            ← DISTINCT (tenant, lab_kalibrasi)
7  warehouses         ← DISTINCT (tenant, normalised room, floor)        (D-8)
8  calibration_devices← trx_inventory                                  (D-5 serial rule)
9  attachments        ← foto_depan, foto_sn, trx_inventory_file         (after the file copy, § 6)
10 calibration_records← trx_kalibrasi                                   (import API key per tenant)
11 inspection_sessions← (qr, date) keys of the 5 per-session tables     (D-6 zone)
12 inspection_results ← the 11 detail tables
13 audit_logs         ← one row per loaded business row, same transaction as its batch
```

### 3.2 Normalisation

`btrim` everything; empty string → NULL; collapse inner whitespace in names; case-insensitive
dedupe keys `lower(btrim(x))`; serial placeholders (`-`, `0`, empty, "none"-like words, length < 3)
→ NULL; photo URLs → bare file name (`substring_index(url,'/',-1)`); decimal comma → point;
numeric parse failures → numeric NULL + `raw_value`.

### 3.3 Session key

`inspection_sessions.legacy_key = no_qrcode || '|' || DATE(created_at)` computed **after** the
timezone conversion of § 3.4 (a 7-hour shift moves a date). The header is
`trx_hasil_pemeriksaan` (8,166 keys); for the 16 keys with two header rows, keep the highest `id`
and quarantine the other. Detail rows join on the same key; a detail key with no header (1 key in
the maintenance table) becomes a header-less session with NULL outcomes rather than being lost.

### 3.4 Timezone (D-6)

Do not hard-code. The ETL takes a per-table zone parameter (`Asia/Jakarta` or `UTC`) and the dry
run prints, for each table, the hour-of-day histogram before and after conversion; the owner
confirms with 3–5 events whose real local time is known. Pure `date` columns are never shifted.

### 3.5 Quarantine

`upstream_import.quarantine (source_table, legacy_id, reason, batch_id, created_at)` — reasons:
`device_not_found` (Q-4, ~13 sessions + 13–91 detail rows per table), `duplicate_header` (Q-8),
`file_missing` (162), `file_type_refused` (§ 6), `value_out_of_range` (kept but flagged), …
Quarantine is reviewed by the operator before sign-off (UP-DB-7).

## 4. Id Mapping

`upstream_import.id_map (source_table, legacy_id) PRIMARY KEY → target_table, target_id,
tenant_id, batch_id, source_row_hash, source_values jsonb, imported_at`. Rules:

- target UUIDs are generated by the ETL (`gen_random_uuid()`), never derived from the legacy id
  (a deterministic UUID from `faskes 17` would be guessable across environments);
- `source_row_hash` = SHA-256 of the canonical source row → drives idempotent re-runs (§ 7);
- merged rows (device-type case duplicates, mapping duplicates) map to the survivor;
- `source_values` holds only the raw values the transform changed (e.g. the original serial of a
  D-5 duplicate, the original `kondisi_alat`) — it is personal-data-free for business tables, and
  **never** populated for `users`;
- the schema is not granted to `callibrator_app` (proven in 04 § 10) and is archived and dropped at
  decommission (UP-DB-9).

## 5. Users and Passwords

**Upstream algorithm** (`vendor/myth/auth/src/Password.php`, default config):
`bcrypt_cost10( base64( sha384_raw(password) ) )`, PHP `$2y$` prefix — all 106 hashes.
**Ours** (`backend/src/utils/password.util.ts`, `auth.service.ts`): bcrypt **cost 12** over the
password itself.

| Option | How | Verdict |
|---|---|---|
| **Invitation + forced set (recommended)** | import users with an unusable random hash, `must_change_password = true`; at cutover send the P10-15 single-use invitation link; unclaimed after N days → account disabled | no foreign hash enters our database; every user re-affirms their identity and e-mail; costs one e-mail round per user (≈ 105) |
| Verify-and-rehash on first login | store the legacy hash in a separate column; at login compute `base64(sha384(pw))`, `bcrypt.compare` against `$2y$` (supported by the common Node bcrypt libraries, to be confirmed in a test), on success rehash at cost 12 and erase the legacy hash | technically safe (bcrypt cost 10 is not broken) but adds a second password path to the auth service, keeps 106 legacy hashes until each user logs in, and cost 10 < our 12; the SHA-384 pre-hash also bypasses bcrypt's 72-byte truncation differently from ours — a subtle equivalence to test |
| Import hashes as-is | — | **refused**: our verifier would never accept them |

Shared institutional accounts (76 of 106 users have no full name; one client account per facility)
are not individual identities under 21 CFR Part 11 — the invitation step is also where the
operator names the real person behind each account (D-3).

## 6. File Migration

### 6.1 Volumes (measured on the owner's local copy, 2026-10-07; nothing opened or copied)

| Folder | Files | Size | Referenced by DB | Missing on disk | Unreferenced |
|---|---:|---:|---:|---:|---:|
| `uploads/foto_depan` | 25,092 | 49.7 GB | 23,584 names | 41 | 1,545 |
| `uploads/foto_sn` | 25,006 | 47.2 GB | 23,585 names | 46 | 1,462 |
| `uploads/inventory` (PDF) | 11,923 | 19.2 GB | 11,646 names | 75 | 353 |
| **Total** | **62,021** | **116.1 GB (108 GiB)** | | **162** | **3,360** |

By type: JPEG 49,037 files (95.4 GB), HEIC 897 (1.1 GB), PNG 160, SVG 4, AVIF 1, PDF 11,920
(19.1 GB), plus **1 shell script and 1 text file** in the certificate folder. Median file 1.9 MB,
p95 3.4 MB, max 8.1 MB. Byte-identical duplicates: 2,224 groups, **3,293 redundant copies, ≤ 6.2 GB**
(SHA-256 over every size-collision candidate; local hashing ran at ~250 MB/s).
The rest of the fork (`writable/logs` 161 MB, `writable/session` 507 files, `vendor`) is **not**
migrated.

To move: the referenced, present files ≈ **58,650 files ≈ 110 GB**.

### 6.2 Pipeline (per file)

1. **Allow-list by content** (magic bytes, not extension): JPEG, PNG, HEIC/HEIF, PDF. Refuse and
   quarantine everything else — the `.sh`, `.txt`, the SVGs (script-capable), the AVIF if the
   viewer cannot render it.
2. **ClamAV scan** (our attachment path already scans, docs/STORAGE/04 § attachments) — the import
   must not bypass it.
3. **SHA-256** → `attachments.checksum`; compare with the source-side checksum (transfer integrity).
4. **Put** at `t/<tenant uuid>/attachments/<attachment uuid>.<ext>` in the tenant's storage
   (platform default or the tenant's own bucket, P8-01), record `storage_key`, `size`, `mime_type`.
5. Insert the `attachments` row (step 9 of § 3.1) only after a successful put; on failure the row is
   quarantined and the object (if any) deleted.

**Deduplication:** do **not** share one object between attachment rows — deleting one row deletes
its object (docs/STORAGE/04), so a shared key would destroy another row's evidence. The ≤ 6.2 GB
saving is not worth it. Instead, the 2,224 duplicate groups go into the data-quality report: the same
photo attached to different devices is itself suspicious (copy-paste during inventory).

**Re-encoding / derivatives** (recommended, estimates not measured): keep the **original bytes**
(evidence; the checksum proves it unchanged) and generate, per image, a display derivative
(longest side 1600 px, JPEG/WebP q≈80, metadata stripped) and a thumbnail (320 px). Typical
phone photos of 1.9 MB shrink to roughly 0.2–0.4 MB at 1600 px — about +15 % storage for both
derivatives, while list and detail pages stop downloading 2 MB originals. HEIC (897) must get a
JPEG derivative (browsers do not render HEIC). EXIF (possibly GPS of the hospital, device make,
timestamps) was **not** measured; derivatives strip it, originals are served only through the
signed download.

### 6.3 Time and cost

| Step | Estimate | Basis |
|---|---|---|
| Read + hash 110 GB locally | ~8 min | measured ~250 MB/s on this workstation |
| Transfer to object storage at 100 Mbit/s | ~2.5 h | 110 GB ÷ 12.5 MB/s |
| … at 1 Gbit/s | ~20–30 min | protocol overhead with ~59 k objects |
| ClamAV, 4 workers | ~1–2 h | assumption: 20–40 MB/s per worker on JPEG/PDF; measure in the dry run |
| Derivatives, 4 workers | ~1–1.5 h | assumption: ~10 images/s per worker |
| **Wall clock (parallel pipeline)** | **~1–4 h** | dominated by link speed and scanning |
| Storage | ~110 GB originals + ~15–20 GB derivatives | at typical S3-class list prices (~USD 0.023–0.025 per GB-month) about USD 3 per month; on the self-hosted S3-compatible store already proven (SeaweedFS/versitygw, U-09) only disk |
| Growth | ~0.25–0.3 GB per day in campaigns | 03 § 8 |

The files can be copied **ahead of cutover** (they are immutable once uploaded, except the
replaced photos of `InventoryController::inventory_update`, which `unlink` the old file): copy
early, then copy only the delta at cutover by name.

## 7. Validation and Reconciliation

Run on the dry run and again after the real load. Each check compares a source query (MariaDB)
with a target query (PostgreSQL), **per tenant** (`id_client` ↔ `tenant_id` via `id_map`).

| # | Check | Source | Target |
|---|---|---|---|
| R-1 | devices per tenant | `SELECT id_client, COUNT(*) FROM trx_inventory GROUP BY 1` | `SELECT tenant_id, COUNT(*) FROM calibration_devices WHERE qr_code IS NOT NULL GROUP BY 1` |
| R-2 | sessions per tenant | `COUNT(DISTINCT no_qrcode, DATE(created_at))` from `trx_hasil_pemeriksaan` per `id_client` | `COUNT(*) FROM inspection_sessions` per tenant + quarantined `duplicate_header`/`device_not_found` |
| R-3 | detail rows per tenant **per section** | `COUNT(*)` of each `trx_*` table per `id_client` | `COUNT(*) FROM inspection_results GROUP BY tenant_id, section` + quarantine |
| R-4 | outcome distribution per section | `status` counts (03 § 4.6) | `outcome` counts — must match code-for-code after § 5 of 04 |
| R-5 | numeric sums | `SUM(REPLACE(terukur_1, ',', '.')+0)` over numeric rows | `SUM(measured_value_1)` |
| R-6 | environment | `AVG`/`MIN`/`MAX` of temperature and humidity per tenant | same on `inspection_sessions` |
| R-7 | calibrations | `COUNT(*)`, `MIN`/`MAX(tanggal_kalibrasi)` per tenant | `calibration_records` with the import API key |
| R-8 | files | referenced names per folder per tenant | `attachments` per folder per tenant + `file_missing`/`file_type_refused` quarantine; every `checksum` equals the source-side hash |
| R-9 | users | members per group | users per (tenant, role) |
| R-10 | completeness | every source row id is in `id_map` or `quarantine` | `SELECT … EXCEPT …` = ∅ for every source table |
| R-11 | isolation | — | no `inspection_results.tenant_id` differs from its session's, no session's from its device's (guaranteed by the composite FKs; asserted anyway) |
| R-12 | app-level smoke | — | the two-tenant tests for the new routes, and a live E2E pass on the dry-run database |

Expected target volumes (from the 2026-10-06 dump): 118 + 1 tenants, ~105 users, 339 device
types, 501 item definitions, ~2,871 type-item links, ≤ 23,722 devices, 3,640 calibration records,
~8,166 sessions, ~279,000 results, ~58,650 attachments, ~330,000 audit rows.

## 8. Idempotency, Re-runs, Rollback and Cutover

**Idempotency.** Each run has a `batch_id`. For every source row: not in `id_map` → insert;
in `id_map` with the same `source_row_hash` → skip; with a different hash → update the mutable
targets (devices, users' profile fields, tenants) and, for append-only targets
(`calibration_records`, submitted sessions), **void-and-supersede** — never update. Because
upstream edits sessions by delete-and-reinsert (new ids, same `legacy_key`), sessions are matched
by `legacy_key`, not by upstream id, and their content hash covers all their detail rows.

**Dry run (UP-DB-6).** A throwaway PostgreSQL 18 (`pgvector/pgvector:pg18`) with our migrations
applied, a throwaway S3-compatible bucket, the latest dump, the full pipeline, then § 7. Measure
and record every step's duration. Repeat until R-1 … R-12 are green and the quarantine is
explained. **Estimated DB time:** staging load of 384 k rows < 1 min; transform + load with
per-row audit rows ~2–10 min (set-based SQL; ~330 k audit rows dominate). Files as § 6.3.

**Rollback.** Before cutover the target is not in use by these tenants: rollback = restore the
pre-import backup taken immediately before the load (our `db-backup` service), and delete the
objects under the import-created tenants' `t/<tenant>/` prefixes. Tenant FKs are RESTRICT
(migration 0030), so "delete the tenants" is not a rollback path — the backup is. After cutover,
there is no rollback to upstream for writes made in Callibrator; the fallback is to keep upstream
read-only and fix forward.

**Dual run and cutover (UP-DB-8).**

1. T-14 d: dry run on the latest dump; operator reviews the reconciliation and quarantine.
2. T-7 d: files copied (bulk); invitations drafted; training.
3. T-1 d: upstream announced read-only window.
4. T-0: freeze upstream writes (maintenance mode) → final dump → delta load (by hash) → delta
   files → reconciliation R-1 … R-11 → invitations sent → Callibrator is the system of record.
5. T+0 … T+30 d: upstream stays **read-only** for lookup; no dual writing (two systems of record
   for the same device history would diverge).
6. T+30 d (or the retention decision): upstream DB and files archived encrypted, then destroyed
   (UP-DB-9); `upstream_import` archived and dropped.

Freeze length: dominated by the delta (a day's rows load in seconds; a day's files in minutes) —
**under 1 hour** if the bulk was loaded ahead.

## 9. Volumes and Run-Time Summary

| Item | Volume | Time (estimate unless measured) |
|---|---|---|
| Dump restore | 43 MB, 52 tables | 8.6 s (measured) |
| Rows | ~384,500 (57.4 MB) | < 1 min stage; 2–10 min transform/load |
| Growth | ~0.8 k rows/day | delta at cutover: seconds |
| Files | 58,650 referenced / 110 GB of 62,021 / 116.1 GB | 1–4 h bulk; minutes for a delta |
| Reconciliation | 12 checks × 119 tenants | minutes |

## 10. Privacy and Compliance (UU PDP, GDPR)

**Roles.** For facility data (devices, inspection results, certificates) the **facility** is the
controller; the operator and Callibrator are processors. For the operator's own staff accounts the
operator is the controller. Indonesia's **UU No. 27/2022 (PDP)** applies; GDPR only if EU data
subjects are involved (none expected), though our GDPR tooling (`consent_records`,
`dsar_requests`) serves both.

| Requirement | Plan |
|---|---|
| Legal basis / agreement | a data-processing agreement between the operator and the platform, and the operator's confirmation that its client contracts allow the transfer; facilities informed before cutover |
| Minimisation | **not migrated:** `auth_logins` (12,191 rows with e-mails and IPs), auth tokens/reset/activation tables, `writable/session`, `writable/logs`, password/reset/activation hashes, upstream original file names, the photo upload log tables, the one user without a group; **migrated:** names/e-mails of active users, facility contact data, device and IPM data |
| Free text | `trx_catatan` (625 non-empty) and room names may contain names — imported as-is (they are the facility's records) but flagged for the facility's review; never copied into logs or reports |
| Purpose limitation | imported data used only for the same purpose (device management for the facility) |
| Security in transit/at rest | dumps and file copies moved over encrypted channels; staging on encrypted volumes; the `upstream_import` schema unreadable by the app role |
| Retention | id map and quarantine: until sign-off + 90 days, then archived encrypted with the upstream snapshot and destroyed per the operator's retention schedule; `auth_logins` not carried (our own login audit starts at cutover) |
| Data subject rights | imported users are ordinary users: DSAR export and erasure work through the existing endpoints; performer snapshots on sessions are evidence and follow the evidence-retention rule (ADR-107 precedent) |
| Local copies | the owner's `mozivid/` copy (36 dumps + 116 GB files) is **real personal data on a workstation**: keep it gitignored, encrypted at rest, and delete it after cutover — this research created no copy outside throwaway containers (record) |
| Residency | prefer storage in an Indonesian region or the self-hosted store, pending the operator's contracts |

## 11. Open Items Carried to the Phases

The owner decisions D-1 … D-11 (04 § 9); confirmation of the timestamp zone (D-6) with real
events; whether the device resource type and the two attachment folders already exist in the
attachment contract; the EXIF content of photos (not measured); ClamAV and derivative throughput
(measure in the dry run).
