# 07 — Data Minimisation: What Is Migrated, Transformed, Archived or Destroyed (P17-04)

> **Ringkasan (Bahasa Indonesia).** Daftar keputusan per tabel dan per kelas berkas: apa yang
> **dipindah**, apa yang **diubah** (mis. nama pelaksana sebagai *snapshot* atau pseudonim, URL
> foto dijadikan nama berkas, e-mail diseragamkan), dan apa yang **tidak dipindah** — riwayat login
> dan IP, sesi, log aplikasi, semua hash kata sandi/reset/aktivasi, nama asli berkas unggahan,
> foto profil, tabel log unggahan API, berkas yang tidak dirujuk, serta skrip shell dan berkas teks
> di folder sertifikat publik. **PDF sertifikat kalibrasi (±11,9 ribu berkas, 19 GB) tidak masuk
> storage** (aturan pemilik 2026-10-07: sertifikat dirender di frontend) — disimpan hanya di arsip
> luring terenkripsi; isi sertifikat lab eksternal yang hanya ada di PDF menjadi temuan F-CERT
> (§ 4.1). Yang masuk storage hanya foto alat (±47 ribu berkas, ±91 GB). Setiap baris punya alasan. Yang tidak dipindah hanya ada di arsip
> terenkripsi upstream sampai masa retensinya habis, lalu dimusnahkan (06 § 6). Model tenant
> mengikuti koreksi pemilik 2026-10-07: tenant = perusahaan kalibrasi, faskes = entitas klien di
> dalam tenant.

**Status: DONE 2026-10-07 — pending the legal review of 06 (P17-03) for the items marked ⚖.**
Counts from 03 (2026-10-06 dump); target names from 04 (proposals until Phase 20). No real value
appears here. Decision basis: [`06-DPIA.md`](./06-DPIA.md) § 3–4. Files: [`08-FILE-POLICY.md`](./08-FILE-POLICY.md).

Outcomes:

| Outcome | Meaning |
|---|---|
| **MIGRATE** | loaded as is (after normalisation of 05 § 3.2) |
| **TRANSFORM** | loaded in a changed form; the change is the minimisation |
| **USE-ONLY** | read by the ETL to build something else; not stored in Callibrator |
| **NOT MIGRATED** | not loaded; stays only in the encrypted upstream archive until 06 § 6 destroys it |
| **NEVER COPIED** | not loaded and not archived beyond the full dump — excluded from every intermediate copy too |

Every source row ends in `id_map` or in quarantine with a reason (05 § 1); a NOT MIGRATED table has
**no extract step at all**, so it cannot leak into staging.

## 1. Tenant and Facility Model Used Here

Following the owner's correction (2026-10-07, replacing the earlier UD-1): the upstream operator
becomes **one provider tenant**; each `mst_faskes` row becomes a **facility client entity inside
that tenant** (target table named by the rewritten tenancy ADR, P12-02); every facility-owned row
carries the facility (`faskes_id`) taken from the upstream `id_client` of the **device** row, never
inferred from a name. Facility users are users of the provider tenant with a mandatory facility
scope (from `trx_mapping_user_client`). Where 04 § 3 and § 6 say "hospital tenant", read "facility
client entity in the provider tenant".

## 2. Per Table

### 2.1 Auth and users

| Table / column | Outcome | Target | Reason |
|---|---|---|---|
| `users.email` | **TRANSFORM** | `users.email`, lower-cased (migration 0063 rule) | needed to invite and identify; normalised |
| `users.username` | MIGRATE | `users.username` (suffix on collision) | the login identity people know |
| `users.fullname` | **TRANSFORM** | `first_name`, `last_name` (split on the last space; 76 empty → derived from the username and **flagged for the invitee to correct**) | NOT NULL in our model; the person fixes it at invitation |
| `users.user_image` | **NOT MIGRATED** | — | 1 non-default image; no purpose; the user can upload again |
| `users.password_hash` | **NEVER COPIED** | unusable random hash + `must_change_password` | UD-5: no foreign hash in our database; invitation instead |
| `users.reset_hash`, `reset_at`, `reset_expires`, `activate_hash` | **NEVER COPIED** | — | credentials; no purpose |
| `users.status`, `status_message`, `force_pass_reset` | NOT MIGRATED | — | myth/auth internals |
| `users.active` | MIGRATE | `is_active` | an inactive upstream account stays inactive |
| `users.created_at` | MIGRATE | `created_at` | provenance |
| `users.deleted_at` | NOT MIGRATED | — | never set upstream (hard deletes) |
| `auth_groups`, `auth_groups_users` | **USE-ONLY** | the role of each user (UD-4, 04 § 6) | the group decides the role; the membership rows themselves are not needed |
| `trx_mapping_user_client` | **USE-ONLY** | the user's **facility scope** | becomes the mandatory scope of a facility user |
| the 1 user with **no group** | **NOT MIGRATED** | — | no role, no purpose; **reported to the owner** as a possible self-registered account (06 R-17, 10 § 3) |
| `auth_logins` (12,191 rows; e-mail, IP, user id, time, success) | **NOT MIGRATED** | — | its purpose (authenticating to upstream) ends at cutover; our login audit starts at cutover |
| last successful login per user (derived from `auth_logins`) | **USE-ONLY** ⚖ | a coarse bucket (≤ 90 days / ≤ 12 months / older / never) in the **operator's account-review report** before invitations; not stored (04 § 6's optional `last_login_at` is **not** loaded) | lets the operator decide not to invite stale accounts without carrying login history |
| `auth_tokens`, `auth_reset_attempts`, `auth_activation_attempts`, `auth_permissions`, `auth_groups_permissions`, `auth_users_permissions` | **NEVER COPIED** | — | empty or credential material |

### 2.2 Master data

| Table / column | Outcome | Target | Reason |
|---|---|---|---|
| `mst_faskes.name_faskes`, `phone`, `address` | **TRANSFORM** (trim, dedupe the 1 case/space group) | facility client entity: name, phone, address | organisational data the reports print |
| `mst_faskes.img_logo` | MIGRATE if the file exists and passes 08 | facility logo | 9 set; organisational |
| `mst_alat` | **TRANSFORM** (5 case groups merged) | global catalogue `device_types` (UD-3) | reference data |
| 12 `mst_*` checklist catalogues | TRANSFORM | `inspection_item_definitions` (versioned, UD-3) | reference data |
| `mst_*.notes` | MIGRATE ⚖ | definition notes | catalogue text; free-text class — reviewed once by the operator, since it becomes **global** |
| 5 `mapping_*` | TRANSFORM (5 duplicate pairs collapsed) | `device_type_inspection_items` | reference data |
| `mst_fotodepan_inventory`, `mst_fotosn_inventory` (480 + 480) | **NOT MIGRATED** | — | an upload log of the dead mobile API; only file names, which the device rows already reference |
| `mst_stok_konsumable` | NOT MIGRATED | — | empty |
| `migrations` | NOT MIGRATED | — | framework log |

### 2.3 Inventory and calibration

| Table / column | Outcome | Target | Reason |
|---|---|---|---|
| `trx_inventory` business columns (QR, type, name, brand, model, condition, accessories, floor, dates, lab) | MIGRATE / TRANSFORM per 04 § 4 | `calibration_devices` + extensions, with `faskes_id` | the facility's register |
| `trx_inventory.sn` | **TRANSFORM** (placeholders → NULL; UD-9 duplicates → NULL with the original in `id_map.source_values`) | `serial_number` | business data; no person |
| `trx_inventory.nama_ruangan` | TRANSFORM (cleaning pass, UD-10) ⚖ | location | free-text class: may contain names; flagged for the facility's review |
| `trx_inventory.foto_depan`, `foto_sn` | **TRANSFORM** — absolute URL → bare file name (host stripped, Q-27) → used to find the file; the stored attachment gets a **generated** name (§ 4) | `attachments` (08) | the URL embeds the old host; the name may be the client's original |
| `trx_inventory.id_user` (registrant) | **TRANSFORM** → performer reference (§ 3) | `created_by` / snapshot | attribution, minimised |
| `trx_inventory.created_at` | MIGRATE where present (368 rows) | | provenance |
| `trx_inventory_file` (11,851 rows: device → certificate PDF file name, upload time) | **USE-ONLY** + archive index | per device, the **count** of archived external certificates and an opaque archive reference (finding F-CERT, § 4.1); **no attachment row, no object** | **owner rule 2026-10-07:** certificates are rendered in the frontend, so **no certificate file of any kind is kept in storage**; the PDFs go to the encrypted offline archive (P31-01) |
| `trx_kalibrasi` (date, room, user) | TRANSFORM | `calibration_records` (actor = the import API key, 04 § 4.7) + performer snapshot | history kept (no upsert) |
| `trx_kalibrasi.nama_ruangan` | MIGRATE ⚖ | record's room snapshot | free-text class; facility review |

### 2.4 Inspection / maintenance (the 16 `trx_*`)

| Table / column | Outcome | Target | Reason |
|---|---|---|---|
| result columns (`status`, `value`, `setting`, `terukur_*`, `nilai_acuan`, `symbol`, `status_kebersihan`, `visit`) | TRANSFORM (codes mapped, decimal comma, raw text kept beside numerics) | `inspection_sessions` / `inspection_results` | the IPM evidence |
| `description` (the item label copied as text) | MIGRATE | result's label snapshot | needed when the catalogue item was deleted (Q-6) |
| `id_user` on every row | **TRANSFORM** → performer reference (§ 3) | session `performed_by` + `performer_snapshot` | attribution, minimised; one per session, not per row |
| `id_client`, `id_alat`, `no_qrcode` | USE-ONLY | session → device → facility | redundant with the device; the device's facility wins (0 mismatches measured) |
| `trx_catatan.description` (625 non-empty) | MIGRATE ⚖ | session note | the facility's record; **flagged for the facility's review**; never copied into logs, reports of the ETL or `audit_logs.changes` |
| `trx_battery` (448), `trx_konsumabel` (11) | MIGRATE | results of their sections | small, but evidence of the sessions they belong to |
| duplicate headers (16), rows without a device | quarantined with a reason | — | 05 § 3.5 |

### 2.5 Outside the database

| Source | Outcome | Reason |
|---|---|---|
| `writable/session/*` (507 files) | **NEVER COPIED** | session data of upstream logins |
| `writable/logs/*` (1,205 files, 161 MB) | **NEVER COPIED** | application logs with PII and stack traces |
| `.env` and every config secret | **NEVER COPIED** | credentials (S-01); rotated by OA-1 |
| `vendor/`, application code, `views_ipm.rar`, the APK in `public/` | NOT MIGRATED | software, not data |
| `info.php` | NOT MIGRATED | deleted on the live site (OA-2) |

## 3. Attribution: the Performer Reference (pseudonymised where the person is gone)

The upstream `id_user` on a device, a session or a calibration date becomes:

| Case | Stored in Callibrator | Not stored |
|---|---|---|
| the user exists and is migrated (company staff or facility staff) | `performed_by` = the migrated user's id (same tenant in the corrected model) **and** `performer_snapshot = { name, role, organisation }` as printed at the time (ADR-107 precedent) | the upstream user id (it lives in `id_map` until it is dropped) |
| the user was **hard-deleted upstream** (13,169 IPM rows, 2,294 devices, Q-2/Q-3) or `id_user` is NULL (1,235 calibration dates) | `performed_by = NULL`, `performer_snapshot = { name: "Former upstream user #<n>" }` where `<n>` is a **per-migration sequence number**, not the upstream id ⚖ | no placeholder `users` row; no guessed name |
| the person later exercises erasure | the user row is anonymised; the snapshot is anonymised **unless** it is part of an issued, signed report (06 § 6–7) ⚖ | |

**Change from 04 § 6:** 04 proposed `"Former upstream user #<legacy id>"`. A legacy id is a stable
identifier that re-identifies the person to anyone holding the upstream archive; a per-migration
sequence number keeps sessions of the same former user grouped (useful for review) while the link
to the upstream id lives only in `upstream_import.id_map` and disappears when it is dropped
(sign-off + 90 days). This is pseudonymisation, not anonymisation: until `id_map` is dropped the
link exists. To be carried into 04 by the P19-02 spec.

**Requirements this places on the build** (P19-02, Phase 21): the DSAR export and the erasure path
cover `performer_snapshot`; the snapshot is never written to logs; `audit_logs.changes` of an
imported row holds `{ source, legacy_table, legacy_id }` only (04 § 7) — no personal value.

## 4. Per File Class

Volumes from 05 § 6.1; the pipeline is [`08`](./08-FILE-POLICY.md).

| Class | Files | Outcome | Reason |
|---|---:|---|---|
| referenced, present, allow-listed photos (JPEG, PNG, HEIC) | ≈ 47,100 | **MIGRATE** original bytes + **TRANSFORM** metadata-free display derivative and thumbnail (HEIC → JPEG derivative) | identification evidence; derivatives are what pages show |
| **certificate PDFs** (`uploads/inventory`, 11,923 files / 19.2 GB; ≈ 11,570 referenced and present) | **NOT MIGRATED into storage** → **encrypted offline archive** outside the application (P31-01), for legal retention; scanned and type-checked on the way into the archive (08 § 5) | **owner rule 2026-10-07**: certificates are rendered in the frontend (ADR-095), no certificate files in storage. See F-CERT (§ 4.1) |
| **original upload file names** (~3,600 keep the client's name) | — | **NOT MIGRATED** — `attachments.originalName` is **generated** (`device-photo-front.<ext>`, `device-photo-serial.<ext>`); the source name lives only in the ETL manifest in `upstream_import` until it is dropped | phone-generated or personal names; no purpose |
| referenced but **missing** on disk | 162 | quarantined `file_missing`; the device is listed in the facility's data-quality report | nothing to move |
| on disk but **unreferenced** | 3,360 | **NOT MIGRATED** (counted per folder in the report) | no record points at them: no purpose |
| byte-identical duplicates | 3,293 redundant copies | each referencing row gets **its own** object (no sharing, 05 § 6.2); groups reported | a shared key would let one deletion destroy another row's evidence |
| SVG (4), AVIF (1), anything not allow-listed | 5+ | **NOT MIGRATED**, quarantined `file_type_refused` | SVG is script-capable; AVIF is outside our allow-list (the operator may convert it by hand) |
| the **shell script** and **text file** in the public certificate folder | 2 | **NEVER COPIED** beyond type detection; reported to the owner (OA-2) | operator artefacts in a public folder (S-13); not records |
| profile images (`img/profile`) | 2 | **NOT MIGRATED** | § 2.1 |

**What moves into storage: device photos only** — on disk 50,098 files / 96.9 GB (front 25,092 /
49.7 GB, serial plate 25,006 / 47.2 GB); referenced and present ≈ **47,080 files ≈ 91 GB**
(estimate, pro rata by count), plus derivatives (~+15 %). This replaces the "~58,650 files /
~110 GB" of 05 § 6.1, which included the certificate PDFs.

### 4.1 Finding F-CERT — certificate information that exists only inside the PDFs ⚖

**What the database holds about external calibration certificates:** per device, the file names of
its PDFs (`trx_inventory_file`, 11,851 rows on 10,951 devices, up to 8 per device), their upload
time (NULL on 3,496), one calibration date per device (`trx_kalibrasi`, 3,640 rows, since
2025-04), a typed calibration date on the device (`trx_inventory.tgl_kalibrasi`, meaning open —
UD-8) and a free-text lab name (`lab_kalibrasi`, 10 values). **Everything else on a certificate
exists only in the PDF:** the certificate number, the issuing lab's accreditation, the
measurement results and uncertainties, the pass/fail statement, the validity or next-due date,
the lab signatory, and — for the ~8,200 PDFs an operator copied in outside the app (00 § 8) —
which calibration event the file belongs to. Upstream never parsed them; no upstream document
prints their content.

Under the owner rule the PDFs are not stored in Callibrator, so **after cutover that information
is not reachable in the application.** Options:

| Option | What it means | Verdict |
|---|---|---|
| **A. Archive-only (recommended)** | PDFs go to the encrypted offline archive with an index `(archive reference → device legacy id, file sequence)`; each migrated device shows "N external certificates archived offline (before <cutover date>)"; the provider retrieves a copy on a facility's request (logged) | follows the rule; **cost:** facilities lose self-service access to historical external certificates — an accreditation reviewer asking for one is answered by the provider, not by the app. The retention period of the archive must cover the facilities' certificate-retention duty ⚖ |
| B. Attach them as user-uploaded documents | store the PDFs as ordinary attachments of the devices | **contradicts the owner rule** ("no certificate files of any kind in storage"); needs an explicit owner decision overriding it. Also brings back 19 GB and the PDF active-content surface (08 § 5) |
| C. Extract the data (manual or OCR) into calibration records | an operator or OCR fills certificate number, lab, date, result per file, then the PDF is archived | follows the rule and restores the data; **cost:** 11.9 k documents; OCR through an external LLM is a cross-border transfer of facility data (06 R-08) and is **not** allowed without counsel's clearance; a targeted manual pass for the **latest certificate of each device in service** (≤ 10,951) is the realistic subset | 

**Decided by the owner 2026-10-07 (as recommended, Phase 12 § 3): archive only (A), plus an optional later data-entry pass (C) recording the latest certificate's key data per device, rendered by the frontend.** The analysis it answered follows.

**Recommendation: A now; C optionally later for the latest certificate per active device, on the
provider's initiative.** Open for the owner: the archive's retention period vs the facilities'
duty to keep calibration evidence; whether future external-lab certificates (F-32, P19-05
"quick calibration-date entry with certificate attachment") may be uploaded at all under the rule
— **the same rule applies to them**, so P19-05 must decide between "data only" and an owner
exception.

## 5. What the Reconciliation Proves About Minimisation

P25-01 adds two checks to R-1 … R-12 (05 § 7):

- **R-13 (absence):** no column of the target database contains a value equal to any upstream
  `password_hash`, `reset_hash` or `activate_hash`, and no target table contains an IP address
  from `auth_logins` — checked by hashing on both sides, so the check itself copies no value into a
  report.
- **R-14 (file names):** no `attachments.original_name` / `file_name` equals an upstream file name.
- **R-15 (no certificate files):** no object exists under any certificate prefix of the tenant, and
  no attachment row's checksum equals the checksum of an archived certificate PDF.

## 6. Open Items ⚖

- Whether the operator's account-review bucket (§ 2.1) is itself acceptable processing of login
  history — counsel; the fallback is to invite every active account.
- Whether `mst_*.notes` contain anything personal (operator's one-time review).
- Whether the "Former upstream user #n" pseudonym or a fully anonymous `"Former upstream user"`
  is preferred by the facilities (accountability vs minimisation).
