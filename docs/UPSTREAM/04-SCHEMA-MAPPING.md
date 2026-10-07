# 04 — Schema Mapping: Upstream `skp_ipm` → Callibrator (PROPOSAL)

> **Ringkasan (Bahasa Indonesia).** Usulan skema target dalam konvensi kita (UUID, `tenant_id`,
> snake_case, `paranoid` + `isDeleted`, indeks di migrasi). Setiap **faskes** upstream menjadi
> **tenant rumah sakit**; SKP (penyedia jasa) menjadi **satu tenant penyedia kalibrasi**; teknisi
> SKP bekerja di tenant faskes lewat fitur baru **service engagement** (perlu ADR dan keputusan
> pemilik). Alat (`trx_inventory`) → `calibration_devices` (+ kolom `qr_code`); 16 tabel `trx_*` IPM
> dipadatkan menjadi **2 tabel baru**: `inspection_sessions` (header yang tidak ada di upstream) dan
> `inspection_results`; 12 katalog `mst_*` + 5 tabel `mapping_*` → `device_types`,
> `inspection_item_definitions`, `device_type_inspection_items`. Hash kata sandi **tidak diimpor**
> (undangan reset). Ini **riset**, belum ada migrasi yang diimplementasikan.

**Status: PROPOSAL, 2026-10-07 — nothing here is implemented.** The source schema and its data
quality are in [`03-DATABASE.md`](./03-DATABASE.md); the ETL is [`05-DATA-MIGRATION.md`](./05-DATA-MIGRATION.md).
Every "existing table" named below was read from `backend/src/models/*.model.ts` on 2026-10-07.
Decisions the owner must take are collected in § 9 (D-1 … D-11); until taken, they are the
recommendations stated, not facts.

Our conventions this follows (docs/DATABASE/00-DATA-MODEL.md, CLAUDE.md): UUID `id`
(`UUIDV4`); camelCase attributes over snake_case columns (`underscored: true`); `tenant_id` NOT
NULL → `tenants` RESTRICT on every tenant-scoped table, enforced by the global hooks;
`timestamps` + `paranoid` + `is_deleted` on business tables; enums as Sequelize `ENUM` with the
value list in `@callibrator/contracts/states` where the frontend shares it; **indexes, CHECKs and
unique constraints in the migration, never on the model** (ADR-100 Am. 3); no blanket `try/catch`
in migrations; per-tenant (never global) uniqueness; a leading index on every FK (D-20); models
via `initModel` + `export =` alone.

---

## 1. Table-Level Mapping (all 52 tables)

| Upstream table | Target | Kind |
|---|---|---|
| `mst_faskes` | `tenants` (one hospital/clinic tenant per row) | EXISTING |
| — (implicit: the operator itself) | `tenants` (one calibration-provider tenant) | EXISTING |
| `users` | `users` | EXISTING |
| `auth_groups`, `auth_groups_users` | `users.role_id` → `roles` (global) | EXISTING (mapping only) |
| `trx_mapping_user_client` | `users.tenant_id` of the client user | EXISTING (mapping only) |
| `auth_logins` | not migrated (optionally `users.last_login_at` from the last success) | — |
| `auth_tokens`, `auth_reset_attempts`, `auth_activation_attempts`, `auth_permissions`, `auth_*_permissions` | not migrated (empty or ephemeral) | — |
| `mst_alat` | `device_types` | **NEW** (global catalogue, D-2) |
| `mst_kelengkapan_alat`, `mst_pemeriksaan_fungsi_alat`, `mst_pemeriksaan_kinerja_alat`, `mst_alat_kerja_digunakan`, `mst_pemeriksaan_keamanan_listrik`, `mst_kondisi_kelistrikan`, `mst_pemeliharaan_alat`, `mst_pemeriksaan_fisik`, `mst_pemeriksaan_keamanan_lain`, `mst_kondisi_lingkungan`, `mst_rekomendasi_hasil_pekerjaan`, `mst_stok_konsumable` | `inspection_item_definitions` (one table, `section` column) | **NEW** (global, D-2) |
| `mapping_fugsi_alat`, `mapping_kelengkapan_alat`, `mapping_kinerja_alat`, `mapping_keamanan_listrik`, `mapping_alat_kerja_digunakan` | `device_type_inspection_items` | **NEW** (global, D-2) |
| `trx_inventory` | `calibration_devices` (+ 4 new columns) | EXISTING, extended |
| `trx_inventory.nama_ruangan`/`lantai` | `warehouses` (as device locations, `calibration_devices.location_id`) | EXISTING (D-8) |
| `trx_inventory.lab_kalibrasi` | `vendors` (`type = CalibrationLab`) per hospital tenant | EXISTING |
| `trx_inventory.foto_depan`, `foto_sn` | `attachments` (`resource_type` device, folder `device-photos`) | EXISTING |
| `trx_inventory_file` | `attachments` (folder `certificates-legacy`) | EXISTING |
| `trx_kalibrasi` | `calibration_records` | EXISTING |
| `trx_hasil_pemeriksaan` + `trx_hasil_maintenance` + `trx_rekomendasi_hasil_pekerjaan` + `trx_catatan` + `trx_kondisi_lingkungan` (+ the implicit `(qr, date)` key) | `inspection_sessions` (one row per session) | **NEW** |
| `trx_kondisi_kelistrikan`, `trx_alat_kerja_digunakan`, `trx_pemeriksaan_keamanan_lain`, `trx_pemeriksaan_fisik`, `trx_keamanan_listrik`, `trx_kelengkapan_alat`, `trx_fungsi_alat`, `trx_kinerja_alat`, `trx_battery`, `trx_pemeliharaan_alat`, `trx_konsumabel` | `inspection_results` (one row per answered item, `section` column) | **NEW** |
| (a session as planned/assigned work) | `maintenance_work_orders` (`type = Preventative`, `status = Completed`), optional link from the session | EXISTING (optional, D-10) |
| `migrations` | not migrated | — |
| `mst_fotodepan_inventory`, `mst_fotosn_inventory` | not migrated (upload log; the referenced files arrive via `trx_inventory`) | — |
| (cross-tenant work by the provider) | `service_engagements` | **NEW** (needs an ADR, D-1) |
| (ETL bookkeeping) | `upstream_import.id_map`, `upstream_import.quarantine` (separate schema, ETL tooling only) | **NEW**, temporary |

Result: 52 upstream tables → **8 existing tables** reused (`tenants`, `users`, `calibration_devices`,
`calibration_records`, `attachments`, `warehouses`, `vendors`, and optionally
`maintenance_work_orders`; `roles` is only referenced) and **6 new tables** (`device_types`, `inspection_item_definitions`,
`device_type_inspection_items`, `inspection_sessions`, `inspection_results`,
`service_engagements`), plus the throw-away import schema.

## 2. Type Conversion Rules (MariaDB 10.5 → PostgreSQL 18)

| MariaDB | PostgreSQL / Sequelize | Rule |
|---|---|---|
| `int(10/11) unsigned AUTO_INCREMENT` id | `uuid` (`UUIDV4`, generated by the ETL) | the old id goes to `legacy_id integer` on NEW tables and to `upstream_import.id_map` for every table (§ 7) |
| `int` foreign id (`id_client`, `id_alat`, `id_user`, `id_inventory`, `id_<item>`) | `uuid` FK, resolved through `id_map` | unresolvable → NULL + `*_legacy_id` column where attribution matters (§ 6), else quarantine |
| `tinyint(1)` (`active`, `flag`, `success`, `force_pass_reset`) | `boolean` | `0`→false, other→true |
| `varchar(255)` | `varchar(n)` (Sequelize `STRING(n)`) | keep 255 for names/labels (max measured 48); `varchar(45/255) no_qrcode` → `varchar(32)` (max 13) |
| `varchar` holding a code (`status` 1/0/-1/-2, `kondisi_alat`, `aksesoris`) | Sequelize `ENUM` with the values in `@callibrator/contracts/states` | mapping tables in § 5 |
| `varchar` holding a number (`value`, `terukur_1/2`, temperature, humidity) | `numeric` **plus** the original in `raw_value varchar(255)` | `,` → `.`; non-numeric → numeric NULL, raw kept |
| `text` | `text` | trimmed; empty string → NULL |
| `date` (`tgl_inventory`, `tgl_kalibrasi`, `tanggal_kalibrasi`) | `date` (Sequelize `DATEONLY`) where the target is a date; `timestamptz` at 00:00 Asia/Jakarta where the target column is `DATE` (e.g. `calibration_records.calibration_date`) | no timezone shift on pure dates |
| `datetime` (naive) | `timestamptz` (Sequelize `DATE`) | interpreted in the zone decided by D-6 (recommended default: `Asia/Jakarta`, per `App.php`), converted with `AT TIME ZONE` |
| `datetime` NULL `created_at` | `created_at NOT NULL` | fallback order: the row's own date column (`tgl_inventory`), else the import time; the fallback is recorded in `id_map` |
| `utf8` / `utf8_general_ci` | database `UTF8`; case-insensitive uniqueness via `lower(btrim(x))` indexes | lossless (no 4-byte characters exist upstream) |
| `deleted_at` (users) | `deleted_at` + `is_deleted` | upstream never sets it |

## 3. Tenant Mapping (the central decision, D-1)

> **Superseded by the owner's clarification (2026-10-07) — ADR-124.** The owner stated that the tenant is the calibration company that serves the facilities. **Decided: option B's shape — one provider tenant, facilities inside it — but with the facility boundary in the global hooks, not in application code.** `mst_faskes` → **`client_facilities`** (tenant-scoped; 118 rows + the tenant's own `is_self` facility) in **one** provider tenant; devices, calibration records, IPM sessions/results, work orders and device attachments carry `client_facility_id` (composite FK `(tenant_id, client_facility_id)`); facility users (`client`, `teknisi_client`) are **facility-bound** users of the provider tenant (`users.client_facility_id`). `service_engagements` (below) is **not** built. Option B's bad implication ("a single missed filter leaks hospital A's devices to hospital B") is answered by ADR-124's deny-by-default second dimension, two-facility tests and guards. The text below is kept for provenance.

**Upstream:** one provider (the operator, "SKP") × 118 client facilities in one database, isolated
only in PHP (03 § 5). **Ours:** a tenant is "one customer organisation — a hospital, a hospital
group member, or a calibration provider" (`docs/PLAN/10-TENANCY-AND-ONBOARDING.md`), isolation is
deny-by-default in the hooks, and **no mechanism lets one tenant's users act in another tenant**:
the hierarchy grants no visibility (ADR-084), roles are global but users belong to one tenant
(`users.tenant_id`), and only the super admin crosses tenants.

### Options

| | A. Hospital tenants + provider tenant + engagements (**recommended**) | B. One provider tenant, facilities as sites inside it | C. Hospital tenants, provider staff duplicated per tenant |
|---|---|---|---|
| Tenants | 118 hospital tenants (`HEALTHCARE ADMIN`) + 1 provider tenant (`CALIBRATOR ADMIN`) | 1 tenant | 118 |
| Where devices/results live | in the **hospital's** tenant (the device owner and data controller) | in the provider's tenant, tagged by a new `client_site_id` | hospital tenant |
| How technicians work | a **service engagement**: an audited, revocable grant from a hospital tenant to the provider tenant, under which provider users act in the hospital's context (new, ADR) | as today | one account per technician **per hospital** (45 staff × up to 118 tenants) |
| Hospital users' isolation | the tenant boundary (hooks) | **application-level** `client_site_id` filter — exactly the "remember the WHERE" model our architecture forbids | tenant boundary |
| Matches our product model | yes (00-PROJECT-OVERVIEW: providers and hospitals "on opposite sides of the same transaction") | no | partly |
| Hospital leaves the provider | revoke the engagement; data stays with the hospital | data must be carved out of the provider tenant | delete accounts |
| ETL complexity | medium | lowest (1:1) | high, and `users.email` is **globally unique** (`user.model.ts` index), so duplicate accounts need fake addresses |
| Bad implications | needs a new cross-tenant feature (security review, two-tenant tests, realtime rooms); performer users live in another tenant → an INNER include of `performer` hides the row (A-90 trap) — mitigated by a performer snapshot (§ 6) | 57 client users of different hospitals share one tenant; a single missed filter leaks hospital A's devices to hospital B; contradicts ADR-084's spirit and the multi-tenancy security doc | unworkable credential sprawl; breaks attribution (one person, many identities) |

**Recommendation: A.** Facilities become hospital tenants; the operator becomes a provider tenant;
`service_engagements` is designed under its own ADR before any provider user can write in a
hospital tenant. **Interim** (if the import must happen before the engagement feature exists): the
ETL still loads into hospital tenants — history is read-only data, written by the import, not by a
provider user — and provider technicians are attributed through the performer snapshot; nothing
about A has to be undone later.

**Which facilities:** all 118 get a tenant row (status `active` for the 114 with devices, the 4
without devices as `suspended`/not created per D-9). Tenant fields: `name` ← `name_faskes` (trimmed),
`phone` ← `phone`, `address` ← `address`, `logo` ← `img_logo` re-keyed to `global/branding/…`
(our public class, docs/STORAGE/04), `code` ← generated (`<slug>-<legacy id>`, owner-editable;
`subdomain` derived from it as `tenant.service#createTenant` does), `email` ← required by the model:
the facility's client user's address if one exists, else a placeholder the owner replaces (D-9),
`plan`/`limit_*` ← the provider's commercial decision (not in upstream).

### `service_engagements` (NEW, design sketch — ADR first)

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NN → tenants | **the client (hospital) tenant** — the row is the hospital's, scoped by the hooks |
| `provider_tenant_id` | uuid NN → tenants RESTRICT | deliberately not named `tenant_id` (as `access_requests.provisioned_tenant_id`) |
| `status` | ENUM `pending`, `active`, `suspended`, `ended` | 409 on an invalid transition |
| `scopes` | ENUM[] (`devices:read`, `inspections:write`, `calibrations:write`, `attachments:write`) | least privilege |
| `starts_on`, `ends_on` | date | contract period |
| `approved_by` | uuid → users | a hospital admin (the consent) |
| `legacy_source` | varchar(32) | `skp_ipm` for engagements created by the import |
| timestamps, `deleted_at`, `is_deleted` | | |

Unique `(tenant_id, provider_tenant_id) WHERE status IN ('pending','active')`. How a provider
user's request acquires the client tenant's context (an explicit "act for tenant X" switch,
audited with `impersonator_id`-like attribution in `audit_logs`) is the ADR's subject; this
document only reserves the table.

## 4. Column-by-Column Mapping

### 4.1 `mst_faskes` → `tenants` — see § 3.

### 4.2 `trx_inventory` → `calibration_devices` (EXISTING)

| Upstream | Target column | Rule |
|---|---|---|
| `id` | `id` (new uuid); `id_map('trx_inventory', id)` | |
| `id_client` | ~~`tenant_id`~~ **`client_facility_id`** (ADR-124; Am. 2, P19-04 spec § 15) | via `id_map('mst_faskes')` → the `client_facilities` row; `tenant_id` = the provider tenant |
| `no_qrcode` | **`qr_code varchar(32)` NEW** | unique per tenant among live rows (partial index); the label physically on the device — scanning it is the upstream workflow |
| `nama_alat` | `name` | trimmed; NOT NULL holds (0 empty) |
| `id_alat` | **`device_type_id uuid` NEW** → `device_types` ~~SET NULL~~ **RESTRICT** (ADR-125 Am. 1 § 5: the catalogue is never deleted) | |
| `id_alat` (type name) | `category` | the type's name, ≤100 chars, for the existing filters |
| `merk` | `manufacturer` | trimmed, empty → NULL |
| `type` | `model` | trimmed |
| `sn` | `serial_number` | placeholders → NULL (Q-17); **duplicates inside a tenant (Q-18)**: D-5 |
| `nama_ruangan` + `lantai` | `location_id` → `warehouses` | one warehouse per distinct normalised `(tenant, room, floor)`: `name` ← room, `description` ← floor, `code` ← `R-0001…`; D-8 |
| `kondisi_alat` | `status` | `Baik`, `Laik` → `active`; `Tidak Baik`, `Rusak` → `inactive`; empty → `active`; the raw value is kept in `id_map.source_values` |
| `aksesoris` | **`accessories_complete boolean` NEW** (optional) | `Ada` → true, `Tidak` → false, NULL → NULL |
| `lab_kalibrasi` | **`calibration_vendor_id uuid` NEW** → `vendors` SET NULL | one `vendors` row (`type = CalibrationLab`, `approval_status` per vendor default) per distinct value per tenant |
| `tgl_inventory` | **`inventoried_on date` NEW** | not `installation_date` (different meaning); 65 dates < 2023 and 8 future dates flagged (Q-12/13) |
| `tgl_kalibrasi` | `next_calibration_date` = `tgl_kalibrasi + interval` **only if** D-7 says it is the *last* calibration date; otherwise it seeds a `calibration_records` row | D-7 |
| `foto_depan`, `foto_sn` | `attachments` rows (§ 4.6) | |
| `id_user` | — (registration actor) → the `CREATE` audit row's `user_id`/`actor_name` (§ 8) | 2,294 orphans (Q-3) |
| `created_at`/`updated_at` | `created_at` ← `created_at` ?? `tgl_inventory` 00:00 WIB; `updated_at` ← `updated_at` ?? same | Q-15 |
| — | `is_deleted false`, `status` per above, `iot_enabled false` | |

New columns on `calibration_devices`: `qr_code`, `device_type_id`, `inventoried_on`,
`calibration_vendor_id`, `accessories_complete` — each nullable (no rewrite, no default needed on PG
11+), indexes in the migration: `calibration_devices_tenant_qr_code_unique` UNIQUE `(tenant_id,
qr_code) WHERE qr_code IS NOT NULL AND deleted_at IS NULL`; leading indexes on `device_type_id`,
`calibration_vendor_id`. The existing `UNIQUE (tenant_id, serial_number)` (migration 0026) stays.

### 4.3 `mst_alat` → `device_types` (NEW, global)

> **Decided 2026-10-07 — ADR-125.** Global as proposed; § 4.5's mapping table is **replaced** by versioned `inspection_templates` / `inspection_template_versions` / `inspection_template_items` (a version *is* the mapping); the ETL seeds version 1 per type. Writes super-admin only; no "engagement-aware path" (no engagements exist under ADR-124). **Specified 2026-10-07 — P19-01 spec [`MEMORY/specs/P19-01-inspection-catalogue.md`](../../MEMORY/specs/P19-01-inspection-catalogue.md) § 4, ADR-125 Amendment 1 (target):** the catalogue tables are **not paranoid** and have no `defaultScope` (`deleted_at`/`is_deleted` below are dropped; `status active/retired` is the only removal; the name is unique across every status); § 4.4 gains structured limits (`limit_op` + `limit_value`/`limit_low`/`limit_high`/`limit_nominal`/`limit_tolerance` + verbatim `limit_text`), hard (`valid_*`) and soft (`warn_*`) input ranges and `input_kind`, and loses `applies_to_all_types` (replaced by base-template membership).

| Column | Type | From |
|---|---|---|
| `id` | uuid PK | new |
| `name` | varchar(255) NN | `nama_alat`, trimmed; case/space duplicates (5 groups, Q-24) merged — every member's legacy id maps to the survivor |
| `legacy_id` | integer, unique | `id` |
| `created_at`, `updated_at`, `deleted_at`, `is_deleted` | | |

Unique `lower(btrim(name)) WHERE deleted_at IS NULL`. **No `tenant_id`** (D-2): a reference
catalogue like `roles`, written only by the super admin (and later the provider through an
engagement-aware path). It must be added to `unscopedModels.d17`'s list with its reason.

### 4.4 Checklist catalogues → `inspection_item_definitions` (NEW, global)

> **Superseded in detail by the P19-01 spec § 4.2 (ADR-125 Am. 1, target):** the column list below is the research proposal; the spec's is authoritative (structured limits, `valid_*`/`warn_*`, `input_kind`, `unit`, `status`, `notes` operator-only, no `applies_to_all_types`, not paranoid). The `section` ENUM is unchanged.

| Column | Type | From |
|---|---|---|
| `id` | uuid PK | |
| `section` | ENUM `environment`, `electrical_supply`, `tools_used`, `other_safety`, `physical`, `electrical_safety`, `completeness`, `function`, `performance`, `battery`, `maintenance_task`, `consumable` | the source table |
| `label` | varchar(255) NN | `description` |
| `symbol` | varchar(50) | `symbol` |
| `setting` | varchar(50) | `setting` (performance) |
| `reference_value` | varchar(50) | `nilai_acuan` (text — only 30 of 184 numeric) |
| `allowed_outcomes` | ENUM[] NN, non-empty | from `status` (`0,1,-1` → `{pass,fail,not_applicable}`; `0,1` → `{pass,fail}` or `{done,not_done}` by section; `1,-1` → `{pass,not_applicable}`) |
| `applies_to_all_types` | boolean NN | `flag` |
| `notes` | text | `notes` |
| `legacy_table`, `legacy_id` | varchar(64), integer; UNIQUE pair | |
| timestamps, `deleted_at`, `is_deleted` | | |

The fixed lists that the PHP form hard-codes (environment, electrical supply, maintenance tasks,
other safety, physical) are seeded from their `mst_*` tables so that every result row can point
at a definition.

### 4.5 `mapping_*` → `device_type_inspection_items` (NEW, global)

`id` uuid; `device_type_id` → `device_types` CASCADE; `item_definition_id` →
`inspection_item_definitions` RESTRICT; `sort_order` integer (upstream id order);
`legacy_table`, `legacy_id`. **UNIQUE `(device_type_id, item_definition_id)`** — the 5 duplicate
pairs of `mapping_fugsi_alat` collapse (Q). Index on `item_definition_id`.

### 4.6 Files → `attachments` (EXISTING) and the storage layer

| Upstream | `attachments` columns |
|---|---|
| `trx_inventory.foto_depan` | `resource_type` = the device resource type, `resource_id` = device id, `folder` = `device-photos`, `original_name` = `front.<ext>` |
| `trx_inventory.foto_sn` | same, `original_name` = `serial-plate.<ext>` |
| `trx_inventory_file.nama_file` | same resource, `folder` = `certificates-legacy`, `original_name` = `calibration-certificate-<n>.pdf` |
| (all) | `file_name` = `<uuid>.<ext>`; **`storage_key` = `t/<tenant uuid>/f/<facility uuid>/attachments/<uuid>.<ext>`** (P8-01 layout, docs/STORAGE/04, with the facility segment of ADR-124 § 9 / 08 § 7; amended by ADR-124 Am. 2); `mime_type` by content sniffing, not extension; `size`; `checksum` = SHA-256; `uploaded_by` = mapped user or NULL; `created_at` = row date |

Two extensions to the attachment contract are needed and belong to the implementing card:
`device-photos` / `certificates-legacy` as allowed folders, and the device as an allowed
`resource_type` if `ATTACHMENT_RESOURCE_TYPES` (loaded in `attachment.service.ts`) does not already
list it. The original upstream file names are **not** stored (some contain personal phone-export
names, 03 § 6); the `id_map` keeps the link.

### 4.7 `trx_kalibrasi` → `calibration_records` (EXISTING)

| Upstream | Target | Rule |
|---|---|---|
| `id` | new uuid; `id_map` | |
| `id_inventory` | `device_id`, `tenant_id` | via `id_map('trx_inventory')` |
| `tanggal_kalibrasi` | `calibration_date` | date at 00:00 Asia/Jakarta |
| `id_user` | `performed_by` **or** `api_key_id` | `calibration_records_actor_exactly_one` (migration 0105) requires one: a mapped user **in the same tenant** would be needed for `performed_by`; provider technicians are in another tenant (§ 3) and 1,235 rows have no user → recommended: **`api_key_id` = a per-tenant, import-only, revoked-after-cutover API key** ("recorded by the import"), with the legacy performer kept in the id map and shown through the performer snapshot |
| `nama_ruangan` | `notes` ("Room at calibration: …") | free text |
| — | `results` NULL, `is_compliant` NULL, `certificate_number` NULL | upstream holds no measurements; the PDFs are attachments on the device |
| `created_at` | `created_at` | |

`calibration_records` is **append-only** (trigger, migration 0057): a wrong import cannot be
updated, only voided/superseded. Hence the dry run (05 § 7) is mandatory before the real load.
The 110 devices with two rows (Q-9): both are imported, ordered by date.

### 4.8 IPM → `inspection_sessions` (NEW, tenant-scoped)

> **Decided 2026-10-07 — ADR-126, ADR-124.** Add `client_facility_id` (NOT NULL, from the device), `template_version_id`, the ADR-062 lifecycle columns (`supersedes_id`, `superseded_by_id`, …, `void_*`), `submitted_*`, `client_ref` (ADR-127); `status` gains `discarded`; **drop `engagement_id`** (no engagements). `template_version_id` NULL only for imported rows (`legacy_key` set). Results: same `client_facility_id`, `template_item_id`; immutable once the session is submitted (trigger).

A session is the upstream key `(no_qrcode, DATE(created_at))` (03 § 4.6).

| Column | Type | From |
|---|---|---|
| `id` | uuid PK | new |
| `tenant_id` | uuid NN → tenants RESTRICT | the device's tenant |
| `device_id` | uuid NN | **composite FK `(tenant_id, device_id)` → `calibration_devices (tenant_id, id)`** — a session can never name another tenant's device (needs `UNIQUE (tenant_id, id)` on devices; proven in § 10) |
| `engagement_id` | uuid → service_engagements, NULL | the provider engagement under which it was done (NULL for imported history until engagements exist) |
| `work_order_id` | uuid → maintenance_work_orders SET NULL, NULL | D-10 |
| `performed_by` | uuid → users RESTRICT, NULL | mapped technician if resolvable |
| `performed_by_legacy_id` | integer | upstream `id_user` (13,169 IPM rows have an orphan user, Q-2) |
| `performer_snapshot` | JSONB `{ name, role, organisation }` | as printed at the time (precedent: `certificates.signed_snapshot`, ADR-107) — makes attribution readable from the hospital tenant without a cross-tenant include |
| `performed_at` | timestamptz NN | `created_at` of the header row (D-6 zone) |
| `visit_number` | smallint 1–99 | `trx_kondisi_lingkungan.visit` |
| `room_name_snapshot` | varchar(255) | `trx_inventory.nama_ruangan` at import (upstream overwrites it on each save) |
| `environment_temperature_c` | numeric(5,2), CHECK −20…80 | environment row 1; out-of-range → NULL + raw kept in results |
| `environment_humidity_pct` | numeric(5,2), CHECK 0…100 | environment row 2 |
| `inspection_outcome` | ENUM `pass`, `fail` | `trx_hasil_pemeriksaan.status` 1/0 |
| `maintenance_outcome` | ENUM `pass`, `fail` | `trx_hasil_maintenance.status` 1/0 |
| `recommendation` | ENUM `fit_for_use`, `needs_calibration`, `not_fit_for_use`, `needs_repair` | `trx_rekomendasi_hasil_pekerjaan.status` 1/0/−1/−2 |
| `notes` | text | `trx_catatan.description` (empty → NULL) |
| `status` | ENUM `draft`, `submitted`, `voided` | imported = `submitted` |
| `legacy_key` | varchar(64) | `<no_qrcode>|<date>`; UNIQUE `(tenant_id, legacy_key)` |
| `created_at`, `updated_at`, `deleted_at`, `is_deleted` | | |

Indexes: `(tenant_id, device_id, performed_at DESC, id)` (device history, ends in `id` per the
paging rule of `88e198c`); `performed_by`; `work_order_id`; `engagement_id`.

### 4.9 IPM detail → `inspection_results` (NEW, tenant-scoped)

> **P19-01 (ADR-125 Am. 1 § 1, § 9, target) hands P19-02 these result columns:** `outcome` uses the wider `INSPECTION_OUTCOMES` (`good`/`minor_damage`/`major_damage` for physical, `available`/`not_available`/`empty` for consumables, besides the values below); `cleanliness_outcome` becomes `cleanliness` (`clean`/`dirty`); add `computed_outcome`, `outcome_source` (`technician`/`computed`), `warn_flag`; `template_item_id` NULL only for ad-hoc rows and imported history. See the P19-01 spec § 5.2.

| Column | Type | From |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NN | session's |
| `session_id` | uuid NN | **composite FK `(tenant_id, session_id)` → `inspection_sessions (tenant_id, id)` CASCADE** |
| `section` | ENUM (as § 4.4) | source table |
| `item_definition_id` | uuid → inspection_item_definitions SET NULL, NULL | by legacy id if it still exists; else by `(device type, section, label)` match; else NULL (Q-6/Q-7) |
| `item_label` | varchar(255) NN | `description` — the snapshot the technician saw |
| `outcome` | ENUM `pass`, `fail`, `not_applicable`, `done`, `not_done` | `status` per section (§ 5) |
| `cleanliness_outcome` | ENUM `pass`, `fail` | `trx_pemeriksaan_fisik.status_kebersihan` |
| `setting`, `reference_value`, `symbol` | varchar(255) | performance/battery/electrical columns |
| `measured_value` | numeric | `value` |
| `measured_value_1`, `measured_value_2` | numeric | `terukur_1`, `terukur_2` |
| `raw_value` | varchar(255) | the untouched text when any numeric parse failed or was ambiguous |
| `sort_order` | integer | upstream id order within the session |
| `legacy_table`, `legacy_id` | varchar(64), integer; UNIQUE pair | |
| `created_at`, `updated_at` | | no soft delete: results die with their session (a voided session keeps them) |

Indexes: `(session_id, section, sort_order)`, `tenant_id`, `item_definition_id`.
Expected size after import: ~279 k rows (03 § 2 minus the per-session tables folded into the
header).

**Integrity rule (recommended):** results are immutable once the session is `submitted` — a
trigger in the style of 0057 (refuse UPDATE/DELETE on a submitted session's results; a correction
voids the session and supersedes it). This replaces upstream's delete-and-reinsert edit (03 § 4.6),
which keeps no history and would fail ISO 17025 / 21 CFR Part 11 attributability.

## 5. Code-Value Mapping

| Upstream | Value | Target |
|---|---|---|
| checklist `status` (completeness, function, other safety) | `1` / `0` / `-1` / empty | `pass` / `fail` / `not_applicable` / NULL |
| `trx_pemeriksaan_fisik.status` (physical) — **corrected 2026-10-07, ADR-125 Am. 1 § 1** (the report prints Baik / C-RR / RB, `pdf_ipm.php`) | `1` / `0` / `-1` / empty | `good` / `minor_damage` / `major_damage` / NULL |
| `trx_pemeriksaan_fisik.status_kebersihan` | `1` / `0` | `clean` / `dirty` |
| `trx_konsumabel.status` (consumable) — **corrected 2026-10-07, ADR-125 Am. 1 § 1** (printed Iya / Tidak / Habis) | `1` / `0` / `-1` | `available` / `not_available` / `empty` |
| `trx_kondisi_kelistrikan.status` | `1` / `-1` | `pass` (value measured) / `not_applicable` |
| `trx_keamanan_listrik.status` | `1` | `pass` (the outcome is in the value; see note) |
| `trx_kinerja_alat.status`, `trx_battery.status` | `1` / `0` / NULL | `pass` / `fail` / NULL (set from the form's `Baik` choice) |
| `trx_alat_kerja_digunakan.status`, `trx_pemeliharaan_alat.status` | `1` / `0` | `done` / `not_done` |
| `trx_hasil_pemeriksaan`, `trx_hasil_maintenance` | `1` / `0` | `pass` / `fail` |
| `trx_rekomendasi_hasil_pekerjaan` | `1` / `0` / `-1` / `-2` | `fit_for_use` / `needs_calibration` / `not_fit_for_use` / `needs_repair` |
| `trx_inventory.kondisi_alat` | `Baik`, `Laik` / `Tidak Baik`, `Rusak` | device `status` `active` / `inactive` |
| `trx_inventory.aksesoris` | `Ada` / `Tidak` | `true` / `false` |
| `auth_groups.name` | see § 6 | role |

Note: electrical-safety rows are always status `1` upstream, so pass/fail against a limit is **not
recorded** there; computing it from `value` against the item's limit is a new feature, not a
migration step.

New unions in `@callibrator/contracts/states` (so the frontend shares them): `INSPECTION_SECTIONS`,
`INSPECTION_OUTCOMES`, `INSPECTION_RECOMMENDATIONS`, `INSPECTION_SESSION_STATUSES`,
`SERVICE_ENGAGEMENT_STATUSES`.

## 6. Users and Roles

> **Superseded in part by the owner's clarification (2026-10-07) — ADR-124.** There is **one** provider tenant; the "mapped facility's tenant" below now reads **the provider tenant, with the user bound to the mapped `client_facilities` row** (`users.client_facility_id`). `client`/`teknisi_client` accounts become **facility-bound** users with a facility-side role (which one is UD-4); `admin`/`user` stay unbound provider staff. A bound `HEALTHCARE ADMIN` is **not** a tenant administrator (ADR-124 § 7) — "our tenant needs an administrator" is met by the provider's own admins. Performer snapshots are still needed: bound users cannot see provider staff.

| Upstream group | Members | Target tenant | Target role (`ROLE_NAMES`) | Rationale |
|---|---:|---|---|---|
| `admin` | 10 | provider tenant | `CALIBRATOR ADMIN` | provider administrators; **not** `SUPERADMIN` (the platform operator is us, not the provider) |
| `user` | 35 | provider tenant | `TECHNICIAN` | they write the IPM and calibration rows |
| `client` | 57 | the mapped facility's tenant | `HEALTHCARE ADMIN` for the first account of each tenant (it is the tenant's only account), else `ROOM USER` (D-3) | upstream "client" is read-mostly; our tenant needs an administrator |
| `teknisi_client` | 3 | the mapped facility's tenant | `HEALTHCARE TECHNICIAN` | facility technicians |
| (no group) | 1 | — | not migrated | |

| Upstream `users` column | Target | Rule |
|---|---|---|
| `email` | `email` | lower-cased (migration 0063 identity rule); globally unique — upstream is unique too |
| `username` | `username` | collision with an existing username → suffix |
| `fullname` | `first_name`, `last_name` | split on the last space; **76 of 106 are empty** → derived from the username, flagged for the invitee to correct (both columns are NOT NULL) |
| `password_hash` | **not imported** (D-4) | `password` set to an unusable random bcrypt hash; `must_change_password = true`; an invitation (P10-15 single-use link) is sent at cutover |
| `active` | `is_active` | |
| `user_image` | `avatar_url` | only 1 non-default → `global/avatars/…`, or dropped |
| `reset_*`, `activate_hash`, `status*`, `force_pass_reset` | not imported | |
| `created_at` | `created_at` | |
| last successful `auth_logins.date` | `last_login_at` (optional) | the login log itself is not migrated |

**Orphans:** IPM/inventory rows written by deleted users (Q-2, Q-3) keep `performed_by = NULL`,
`performed_by_legacy_id`, and a snapshot `{ name: "Former upstream user #<legacy id>" }` — no
placeholder `users` rows are created (they would need fake unique e-mails and would count as seats).

## 7. Legacy Ids, Audit and Soft Delete

- **Traceability.** New tables carry `legacy_id` (+ `legacy_table` where one target table merges
  several sources). Existing tables (`tenants`, `users`, `calibration_devices`,
  `calibration_records`, `attachments`, `warehouses`, `vendors`) get **no** import columns; their
  link is `upstream_import.id_map (source_table, legacy_id) → (target_table, target_id, tenant_id,
  batch_id, source_row_hash, source_values jsonb)`. The schema is created by the ETL tooling, never
  granted to `callibrator_app` (proven, § 10), kept for the reconciliation window and then archived
  and dropped (05 § 8).
- **Audit.** Every imported business row gets one `audit_logs` row **in the same transaction as
  its batch**: `action = CREATE`, `actor_type` = the system/import actor, `actor_name` =
  `upstream-import <batch id>`, `resource_type`/`resource_id` = the row, `changes` =
  `{ source: "skp_ipm", legacy_table, legacy_id }` (no personal values). One row per business row
  ≈ 330 k audit rows; acceptable (`audit_logs` is append-only, no delete path). Alternative: one
  row per batch per tenant with the id range — cheaper, weaker per-record provenance; owner's
  choice in D-11.
- **Soft delete.** Upstream never soft-deleted; everything imports with `is_deleted = false`,
  `deleted_at = NULL`. Upstream hard deletes are invisible to us (they happened before the dump).

## 8. Indexes and Constraints Summary (all in migrations)

| Table | Constraint / index |
|---|---|
| `calibration_devices` | `UNIQUE (tenant_id, id)` (target of composite FKs); partial `UNIQUE (tenant_id, qr_code)`; FK indexes `device_type_id`, `calibration_vendor_id` |
| `device_types` | `UNIQUE lower(btrim(name)) WHERE deleted_at IS NULL`; `UNIQUE legacy_id` |
| `inspection_item_definitions` | `UNIQUE (legacy_table, legacy_id)`; `CHECK cardinality(allowed_outcomes) > 0` |
| `device_type_inspection_items` | `UNIQUE (device_type_id, item_definition_id)`; index `item_definition_id` |
| `inspection_sessions` | composite FK to devices; `UNIQUE (tenant_id, id)`; `UNIQUE (tenant_id, legacy_key)`; range CHECKs; index `(tenant_id, device_id, performed_at DESC, id)`; FK indexes |
| `inspection_results` | composite FK to sessions; `UNIQUE (legacy_table, legacy_id)`; index `(session_id, section, sort_order)`; FK indexes |
| `service_engagements` | partial unique live pair; FK indexes |

No global uniqueness on any tenant-owned value (the QR code and serial are per tenant — a global
one would be an existence oracle, CLAUDE.md traps).

## 9. Decisions for the Owner

> **2026-10-07:** D-1 decided by the owner as **revised UD-1** (the provider is the tenant; facilities are clients inside it — ADR-124); D-2 decided as UD-3 (global versioned catalogue — ADR-125). D-9 now reads "which facilities become `client_facilities` rows" (no tenant per facility). The others are carried as open questions (BACKLOG Q-57·UD-n).

| # | Decision | Recommendation | Why it is not ours to take silently |
|---|---|---|---|
| **D-1** | Tenant model: A (hospital tenants + provider tenant + engagements), B (one tenant with sites) or C | **A**, with `service_engagements` under a new ADR | it adds the first cross-tenant working path to a system whose ADR-084 says the hierarchy never grants access |
| **D-2** | Device types and checklists: platform-global catalogue, or owned by the provider tenant | **global** reference data (like `roles`), super-admin curated | a new table without `tenant_id` needs an ADR reason (00-DATA-MODEL); provider-owned rows referenced from hospital tenants would be cross-tenant FKs |
| **D-3** | Role of the upstream `client` account | `HEALTHCARE ADMIN` for each tenant's first account, others `ROOM USER` | privilege level for hospital staff |
| **D-4** | Passwords | **do not import**; invitation + forced set (05 § 5) | affects every upstream user's first login |
| **D-5** | Duplicate serials inside a tenant (624 groups) | keep the serial on the **oldest** device of each group, NULL on the others, original kept in `id_map.source_values` and listed in a per-tenant data-quality report | changes visible device data |
| **D-6** | Timezone of upstream `DATETIME`s | verify with the operator on 3–5 known events, per table (03 § 8.4); default `Asia/Jakarta` | a 7-hour error moves sessions across dates and corrupts the session key |
| **D-7** | Meaning of `trx_inventory.tgl_kalibrasi` (last calibration? next due?) and calibration interval | SME answer; until then import only `trx_kalibrasi` as records and set no `next_calibration_date` | regulatory dates |
| **D-8** | Rooms: `warehouses` as locations (existing pattern) or a new `rooms` table | `warehouses`, after a cleaning pass (3,099 raw room/facility pairs) | product vocabulary ("warehouse" for a ward) |
| **D-9** | Which facilities become tenants (4 have no devices, 63 have no client user) and their contact e-mail | all with devices; e-mail from the client account or provided by the operator | commercial onboarding |
| **D-10** | Also create a `maintenance_work_orders` row per imported session | **no** for history (8 k completed orders add noise); yes for future planned IPM | reporting expectations |
| **D-11** | Audit granularity for the import | one audit row per imported business row | cost vs provenance |

## 10. Proof on PostgreSQL 18 (sketch, synthetic data)

On a throwaway `pgvector/pgvector:pg18` container (`up-db-pg18`, PostgreSQL **18.6**, removed
afterwards) a **sketch** of the core of this design was created — minimal `tenants`, `users`,
`calibration_devices` (with the new columns and the composite-FK target), `device_types`,
`inspection_item_definitions`, `device_type_inspection_items`, `inspection_sessions`,
`inspection_results`, `upstream_import.id_map` and a decimal-comma parser — with CHECKs instead of
ENUMs (the real migration uses the ENUM convention). **Synthetic data only**: 3 tenants, 5 users,
3 types, 20 items, 20 mappings, 200 devices, 400 sessions, 2,666 results.

| Check | Result |
|---|---|
| a session in tenant A naming a device of tenant B | refused: `inspection_sessions_device_same_tenant_fkey` |
| a result in tenant B naming a session of tenant A | refused: `inspection_results_session_same_tenant_fkey` |
| outcome code `'1'` (an upstream code leaking through) | refused: `inspection_results_outcome_check` |
| humidity 120 % | refused: `inspection_sessions_environment_humidity_pct_check` |
| duplicate QR inside a tenant | refused: `calibration_devices_tenant_qr_code_unique` |
| duplicate serial inside a tenant (the Q-18 case) | refused: `calibration_devices_tenant_serial` — confirms D-5 is needed |
| empty `allowed_outcomes` | refused: `inspection_item_definitions_allowed_outcomes_check` |
| the same QR in another tenant | accepted (no global oracle) |
| a soft-deleted device's QR re-issued | accepted (partial index) |
| `callibrator_app` reads `upstream_import.id_map` | refused: `permission denied for schema upstream_import` |
| `callibrator_app` reads the new tables | accepted |
| `'2024-02-02 09:00:00'` naive, as Asia/Jakarta | stored `2024-02-02 02:00:00+00` |
| `to_num('12,5')`, `to_num(' 7.25 ')`, `to_num('n/a')` | `12.5`, `7.25`, NULL |
| device-history query plan | `Index Only Scan using inspection_sessions_tenant_device_performed_at` |

What this does **not** prove: the Sequelize models and hooks over these tables, the ENUM types,
the migration files themselves, or any real-data load.

## 11. Migration Files I Would Write (proposal — NOT implemented)

Numbers continue after the last manifest entry, `0110-search-tenant-gin` (`backend/src/config/migrator.ts`);
renumber at implementation time. Each: one transaction, idempotent (`to_regclass` / `pg_constraint`
checks as 0099), reversible `down`, **no blanket try/catch**, indexes and CHECKs here and not on
the model, verification `\d` block in its header.

| # | File | Creates | Depends on |
|---|---|---|---|
| 1 | `0111-device-types.ts` | `device_types` (+ unique name index); `calibration_devices.device_type_id` + FK + index | — |
| 2 | `0112-calibration-device-upstream-columns.ts` | `calibration_devices.qr_code`, `inventoried_on`, `calibration_vendor_id`, `accessories_complete`; `UNIQUE (tenant_id, id)`; partial unique QR; FK indexes | 0111 |
| 3 | `0113-inspection-catalogue.ts` | `inspection_item_definitions`, `device_type_inspection_items`, their ENUM types | 0111 |
| 4 | `0114-inspection-sessions.ts` | `inspection_sessions`, `inspection_results`, ENUM types, composite FKs, CHECKs, indexes | 0112, 0113 |
| 5 | `0115-inspection-results-immutable.ts` | trigger: results of a `submitted` session refuse UPDATE/DELETE (as 0057); grants checked as `callibrator_app` | 0114 |
| 6 | `0116-inspection-menu-grants.ts` | menu group `inspections` + role grants (as 0101) | 0114 |
| 7 | `0117-service-engagements.ts` | `service_engagements` + `inspection_sessions.engagement_id` FK — **only after its ADR** | 0114, ADR |
| 8 | `0118-attachment-folders.ts` (if a DB-level list exists) | allow `device-photos`, `certificates-legacy` | — |

Not a migration: the `upstream_import` schema — created and dropped by the ETL tool
(`backend/src/scripts/upstream-import/`, 05), because it must not exist in every deployment.

With each table: a model (`deviceType.model.ts`, `inspectionItemDefinition.model.ts`,
`deviceTypeInspectionItem.model.ts`, `inspectionSession.model.ts`, `inspectionResult.model.ts`,
`serviceEngagement.model.ts`), the global ones listed in `unscopedModels.d17` with their reason, a
`*.openapi.ts` contract per route, `@two-tenant` tests over `twoTenantSuite` + `memoryDb` for every
`:id` route, includes of `performer` with `required: false`, and `upgradeBoot.am3.live` passing
(no model index on a migration-added column).

## 12. Database Phases (for the coordinator to merge with the code phases)

Merged into the plan's Phases 12 … 31 on 2026-10-07 (index `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`, § 1); the column *Now* gives the phase each draft phase became.

| Phase | Now | Name | Output | Exit evidence |
|---|---|---|---|---|
| UP-DB-1 | Phase 14 | Structure research | 03, 04, 05 (this set) | record `2026-10-07-upstream-database-research` ✔ |
| UP-DB-2 | Phase 12 | Decisions | D-1 … D-11 answered; ADRs: tenant model + `service_engagements` (D-1), global catalogue (D-2), password policy for imported users (D-4) | ADRs in `MEMORY/DECISIONS.md` |
| UP-DB-3 | Phase 19 | Schema migration design → spec | `MEMORY/specs/UP-DB-3-*.md` per migration; contracts unions | spec reviewed |
| UP-DB-4 | Phase 20 | Migration implementation | migrations 0111–0118, models, routes' data layer, two-tenant tests, immutability trigger tests as `callibrator_app` | `make verify` green; `upgradeBoot.am3.live`; `make migrate-verify` |
| UP-DB-5 | Phase 24 | ETL tool | `backend/src/scripts/upstream-import/` (extract → stage → transform → load), id map, quarantine, file copier | unit tests on synthetic fixtures; no real data in the repo |
| UP-DB-6 | Phase 24 | ETL dry run | full run from the latest dump into a throwaway PG 18 + throwaway storage | 05 § 7 reconciliation all green; timings recorded |
| UP-DB-7 | Phase 25 | Reconciliation and sign-off | per-tenant counts/sums report reviewed by the operator; D-5/D-7 data-quality lists resolved | signed reconciliation |
| UP-DB-8 | Phase 30 | Cutover | freeze upstream → final dump → load → invitations → read-only upstream | 05 § 8 checklist; post-cutover reconciliation |
| UP-DB-9 | Phase 31 | Decommission | archive and drop `upstream_import`; upstream DB and files retained per retention decision, then destroyed | retention record |
