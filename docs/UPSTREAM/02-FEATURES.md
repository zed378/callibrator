# 02 — Upstream Features, Gap Status and Implementation Notes

> **Ringkasan (Bahasa Indonesia).** Dokumen ini mendaftar **81 fitur** upstream yang terlihat oleh
> pengguna, masing-masing dengan lokasi di kode upstream, cara kerjanya, status di Callibrator, dan
> catatan implementasi untuk stack kita (model/migrasi, service, route, kontrak Zod, gerbang izin
> `dynamicAccess`, baris audit, isolasi tenant, uji dua-tenant; halaman frontend, i18n ID/EN, token
> palet hangat), ukuran (S/M/L), ketergantungan dan risiko. Rekap status: **Ada 17 · Sebagian 29 ·
> Belum ada 30 · Tidak diadopsi 5**. Celah terbesar ada di **IPM** (F-34..F-58: template ceklis per
> jenis alat, formulir IPM, riwayat, laporan PDF) dan di akses **penyedia jasa ke banyak faskes**
> (F-17). Beberapa fitur upstream **sengaja tidak diadopsi** karena tidak aman (registrasi terbuka,
> halaman publik dengan nomor QR berurutan tanpa token, endpoint debug).

**Status:** research, 2026-10-07. Statuses as in 01. Sizes: **S** ≤ 2 days · **M** ≤ 1 week ·
**L** > 1 week (one developer, including tests). Table names on our side are **proposals**; the DB
agent's [`04-SCHEMA-MAPPING.md`](./04-SCHEMA-MAPPING.md) is authoritative for names once written —
where it disagrees with this file, 04 wins and this file is corrected.

**Reconciled with 04 on 2026-10-07** (minimal edits, coordinator): `ipm_sessions`/`ipm_session_items` →
`inspection_sessions`/`inspection_results`; `ipm_templates`/`ipm_template_items` →
`inspection_item_definitions` + `device_type_inspection_items` (versioning, decided by the owner as
UD-3, is designed in P19-01); `asset_tag` → `qr_code`, unique per tenant; room/floor → `location_id`
(`warehouses`, D-8); calibration lab → `calibration_vendor_id`; accessories → `accessories_complete`;
attachment purposes → folders `device-photos` / `certificates-legacy`; recommendation and outcome enum
values and session statuses as in 04 § 4.8–4.9, § 5. Route paths are unchanged (they are not table
names). The plan is Phases 12 … 31, indexed in [`../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## How to Read the Implementation Notes — Conventions Every Feature Inherits

Stated once here, not repeated per row. A row only adds what is specific to it.

**Backend (each new or changed endpoint):**

1. **Model + migration:** `initModel` + `export =` (`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`
   § Models); UUID PK; `tenant_id` UUID NOT NULL FK `tenants.id` on every tenant-owned table;
   `is_deleted` soft delete (attribute `isDeleted`); `created_by`/`updated_by`; indexes created **in
   the migration**, never on a model for a column a later migration adds (ADR-100 Am. 3); no
   blanket `try/catch` in migrations; global uniqueness forbidden — uniqueness is `(tenant_id, …)`.
   Platform-owned catalogues (no `tenant_id`) are listed in `unscopedModels.d17.test.js` with the
   reason.
2. **Service** in `backend/src/services/*.service.ts`; raw SQL only through `sql()`
   (`utils/sql.util.ts`) with a bound tenant predicate.
3. **Route** `export = router`; `auth` → `dynamicAccess("<slug>", "read"|"write")` →
   `validate(schema, { from: [...] })` (Zod, `validators/input.ts`) → controller. Contract in the
   route's `*.openapi.ts`. A route without a gate fails `routePermissionGuard.p604`.
4. **Audit:** every mutation writes an audit row **inside its transaction** (`services/audit.service.ts`).
5. **Envelope:** lists put rows in `data` and paging in top-level `meta`; 400 validation, 403 own-
   tenant permission, **404 cross-tenant**, **409 invalid state** with a state explanation.
6. **Tests:** a two-tenant test asserting **404** for every `:id` route (`fixtures/twoTenantSuite.ts`
   over `fixtures/memoryDb.ts`, marker `@two-tenant`), unit tests to the 100 % gate, and a live
   E2E spec for each new page flow. All new code TypeScript, tests included.

**Frontend (each new or changed page):** `frontend/src/app/dashboard/<page>/page.tsx` with
`components/` and `hooks/`; data through the typed client in `frontend/src/api/services/*.service.ts`
(generated `schema.d.ts`); strings in `frontend/src/i18n/messages/id.ts` **and** `en.ts`; colours
from the warm palette theme tokens (`globals.css` `@theme`), never hex; one `<main>`/`<h1>`; nonce
CSP (no inline scripts); icon-only buttons named; mobile-first for field screens; menu item behind
the same slug as the backend gate.

**Slugs proposed:** `equipment` (existing — devices, photos, documents, calibration dates), **`ipm`**
(new — capture, history, report), **`ipm-templates`** (new — platform catalogue admin, super admin
write / provider admin read), reports under the existing reports gate (`canReadReports`).

---

## A. Authentication and Accounts (M01, M02)

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-01 | Log in with **username or email** + password | myth `AuthController::attemptLogin`, view `auth/login.php` | **Exists** | our login accepts email/username (`auth.service.ts`). **Migrated passwords:** myth hashes `bcrypt(base64(sha384(pw)))`; either add a legacy verifier that re-hashes on first successful login (flag `legacyHash`) or force a reset for all 106 users — decide in Phase 17 | S | legacy-hash verifier is security-sensitive code |
| F-02 | Log out | myth `logout` | **Exists** | — | — | — |
| F-03 | **Open self-registration**, auto-active, no group | myth `register` + edited vendor config | **N/A** | not adopted (S-04). Equivalent onboarding: invitation + `request-access` | — | — |
| F-04 | Forgot / reset password by email | myth `forgot`, `reset-password` | **Exists** | `frontend/src/app/forgot-password` | — | — |
| F-05 | "Remember me" checkbox (disabled server-side) | `auth/login.php` | **N/A** | our sessions + refresh policy apply | — | — |
| F-06 | Admin lists users with group and description | `AdminController::index`, `admin/index.php` | **Exists** | `dashboard/users` | — | — |
| F-07 | Admin creates a user (email, full name, username, password) | `userRegister` → myth `attemptRegister` | **Exists** | `POST /api/v1/user/create` | — | — |
| F-08 | Admin assigns a user to a group | `mappingUser`, `mappingUserSave` | **Exists** | `POST /api/v1/roles/assign` | — | role map in 01 |
| F-09 | Admin creates / renames groups | `Group::groupSave`, `AdminController::groupSave` | **Exists** | roles are platform-global (ADR-064): super admin only; provider admins get no role CRUD | — | — |
| F-10 | Admin resets another user's password (with confirmation) | `resetPasswordForm`, `adminResetPassword` | **Exists** | `POST /api/v1/user/:userId/password/reset` | — | — |
| F-11 | Edit own profile — admins: name, email, username, photo, password; others: password only | `editProfile`, `editProfileSave` | **Exists** | `dashboard/profile`, `change-password`, avatar upload | — | — |
| F-12 | User detail page | `AdminController::detail` | **Exists** | — | — | — |

## B. Facilities and Provider Access (M03)

> **Superseded by the owner's clarification (2026-10-07) — ADR-124.** The notes below were written for "facilities become tenants". The decided model: **the tenant is the provider (the calibration company); each facility is a `client_facilities` row inside it.** F-13 … F-15 become facility CRUD inside the provider tenant (tenant administrator), not tenant creation. F-16 is a facility-bound user (`users.client_facility_id`). **F-17 needs no cross-tenant access:** provider staff are unbound users of the tenant and see every facility; facility staff are bound to theirs by the second, deny-by-default scope dimension (cross-facility = 404). F-26's facility picker is a field on the device form (validated by the composite key), not a tenant switch. F-18 stays open (UD-10). The per-row text is kept for provenance.

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-13 | Facility list with name search, 5 per page | `FaskesController::index`, `masterData/faskes.php` | **Partial** | facilities become tenants: `dashboard/tenants` (super admin). If option 2 of 00 § 10 is chosen instead, a `client_site_id` inside one tenant (04 § 3 option B) | S | Phase 12 tenancy ADR |
| F-14 | Add facility (name, phone, address, logo name as text) | `FaskesController::save` | **Partial** | `POST /api/v1/tenant/create` + `/:tenantId/logo` (real upload). Provider admins request facility onboarding; super admin approves (`accessRequests`) | S | same |
| F-15 | Rename facility | `accountEdit` | **Partial** | `PATCH /api/v1/tenant/edit` | S | same |
| F-16 | Map a facility user to exactly one facility | `mappingUserClient*`, `trx_mapping_user_client` | **Exists** | by design: a facility user simply lives in the facility tenant | — | — |
| F-17 | **Provider staff work across every client facility** (pick facility, register devices, do IPM) | implicit: admins/technicians are unscoped; `getClient` picker in forms | **Missing** | **Option 1 (recommended; decided by the owner 2026-10-07 as UD-1):** the tenant-level grant is 04's `service_engagements` (04 § 3); how a user acts under it (e.g. per-user memberships `(user_id, tenant_id, role_id, granted_by, granted_at, revoked_at)`) is the ADR's subject (P12-02); login yields the home tenant; `POST /api/v1/session/tenant` switches the **active** tenant after checking an active membership (re-issue token, audit `TENANT_SWITCH`); tenant context middleware unchanged (one tenant per request). Facility admin can see and revoke provider memberships in their tenant. Frontend: tenant switcher in the top bar, last-used tenant remembered. Two-tenant tests: a member of A but not B gets 404 on B | **L** | **ADR required**; touches auth, session, socket tokens, audit attribution, rate limits; biggest risk in the programme |
| F-18 | Facility hierarchy (district office → health centres) | none — typed into the device's room field | **Partial** | `tenant_hierarchies` gives structure only (ADR-084: no data visibility); or model centres as `warehouses` (locations) inside one tenant. ETL must decide per facility | M | owner/SME decision; ETL parsing of free text |

## C. Device-Type Catalogue and Checklist Templates (M04)

> **Decided 2026-10-07 — ADR-125.** One global catalogue without `tenant_id`; versions `draft → published → retired`, exactly one published per template, a published version immutable and self-contained (items copied in; the base template of F-21 materialised at publish); sessions pin the version. Writes are super-admin only; tenants propose through the tenant-scoped `inspection_template_proposals` (F-22's "provider admin may propose").

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-19 | **Device-type catalogue** (344 types) with search picker | `mst_alat`, `getAlkes`/`getAlkesEdit` (select2) | **Partial** | platform table `device_types` (04 § 4.3); `calibration_devices.device_type_id` FK (keep `category` for compatibility, backfilled). `GET /api/v1/device-types?search=` (gate `equipment` read) | M | dedupe 5 case/space duplicate groups (03 Q-24) |
| F-20 | **Per-type checklist templates**: tools used, function checks, completeness items, electrical-safety tests (with limits), performance tests (setting + reference value) | `mapping_*` + `mst_*`, `IpmController::getDataInventory`, `Apiuser::data_ipm` | **Missing** | `inspection_item_definitions` + `device_type_inspection_items` (04 § 4.4–4.5), with a version dimension designed in P19-01 (status draft/published/retired; items: section, label, input kind, unit, limit op/value, setting, reference value, sort); `input_kind` ∈ `check`, `tri_state` (good/not/NA), `condition_clean` (B/RR/RB + clean/dirty), `measured_with_limit`, `setting_measured_reference`, `text`. **Publishing a version freezes it**; sessions snapshot the version id  **Specified 2026-10-07 in [`MEMORY/specs/P19-01-inspection-catalogue.md`](../../MEMORY/specs/P19-01-inspection-catalogue.md) (ADR-125 Am. 1, target):** ADR-125's kinds incl. `measured`; outcome sets per section (physical good/minor/major damage + clean/dirty; consumable available/not available/empty); structured limits parsed by one shared `parseLimit` (~75 % of the upstream performance references evaluable, the rest printed only) | **L** | seeding from upstream catalogues (184 performance + 155 function + 93 completeness + 42 tools + 10 safety items); limit strings like "≤ 100 µA" must be parsed into op/value/unit |
| F-21 | **Global sections** common to every IPM: environment (temperature °C, humidity %), supply (mains V; UPS/stabilizer V or N/A), other safety (placement; wheels/trolley/bracket), physical (main unit, accessories), maintenance tasks (6), recommendation codes | `mst_kondisi_*`, `mst_pemeriksaan_keamanan_lain`, `mst_pemeriksaan_fisik`, `mst_pemeliharaan_alat`, `mst_rekomendasi_hasil_pekerjaan`; partly hard-coded in the form | **Missing** | a platform "base template" merged into every type template; codes from the **form**, not the stale catalogue notes (D-04) | M | — |
| F-22 | Catalogue maintenance UI (upstream has none — seeders/SQL only) | — | **Missing** | `dashboard/ipm-templates`: list types, edit draft template, publish; super admin write, provider admin may propose (draft) for review. Audit every publish | M | governance: who may change a template used in compliance reports |

## D. Device Inventory (M05)

> **Specified 2026-10-08 — P19-03 spec [`MEMORY/specs/P19-03-device-extensions.md`](../../MEMORY/specs/P19-03-device-extensions.md), ADR-132 (target); where a row below differs, the spec wins.** F-23: the QR is normalised with the **tenant's** prefix/digit settings (no hard-coded `SKP`), unique per tenant over every row, set only by provider staff; lookup `GET /api/v1/calibration-devices/by-qr/:qrCode` (facility-accessible, the same 404 for every miss). F-24: condition is its own column (`good`/`not_good`/`broken`), not the status; rooms are `warehouses` of kind `room` with a floor, inside the device's facility; registrant in `created_by`. F-25/F-28: photos carry `attachments.purpose` (front / serial plate / other), `POST`/`DELETE /calibration-devices/:id/photos`, replace in one transaction; not mandatory at the API (`photosComplete` computed); no `folder` semantics. F-26: the facility is a field of the unbound create (required in a multi-facility tenant).

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-23 | Register a device with a **QR sticker number**, normalised to `SKP` + 6 digits, **unique**, checked before save | `inventorySave`, `inventorySaveClient` | **Partial** | add `qr_code varchar(32)` (normalised by a pure function with tests) to `calibration_devices`; unique **per tenant** among live rows, partial index `(tenant_id, qr_code)` (04 § 4.2), 409 + explanation on a duplicate (never a global unique — the existence-oracle trap). Lookup `GET /api/v1/calibration-devices?qrCode=` | M | F-17; global-uniqueness trap; 4 non-conforming legacy QR values |
| F-24 | Device fields: type, name (snapshot of type name), brand, model, S/N, room, floor, condition, accessories present, inventory date, calibration date, calibration lab | `trx_inventory`, form `inventory/input_inventory.php` | **Partial** | existing: `name`, `manufacturer`, `model`, `serialNumber`, `status`, `locationId`, `installationDate`, `nextCalibrationDate`. New (04 § 4.2): `device_type_id`, `qr_code`, `inventoried_on` date, `calibration_vendor_id` (→ `vendors`), `accessories_complete` bool (`Ada`→true, `Tidak`/`Tidak Ada`→false, D-02); room + floor → `location_id` (`warehouses`, D-8); condition `Baik`/`Laik` → `status` active, `Tidak Baik`/`Rusak` → inactive (04 § 5; a separate condition column is a P19-03 question); registering user → the CREATE audit row. Zod: all optional except name/type/asset tag | M | S/N uniqueness conflict (03 Q-18): relax `UNIQUE(tenant_id, serial_number)` to non-unique + warning, or ETL suffixing — ADR |
| F-25 | **Mandatory front photo and serial-plate photo** at registration | `foto_depan`, `foto_sn` | **Missing** | attachments with `resourceType: device`, folder `device-photos` (04 § 4.6); `POST /api/v1/calibration-devices` accepts multipart or a two-step "create then attach" with the device flagged incomplete until both exist. Server-side: image MIME sniffing (`fileValidation.util.ts`), size cap, **HEIC → JPEG** conversion, EXIF strip (GPS), thumbnail generation; virus scan (existing ClamAV) | M | storage cost (116 GB legacy); EXIF privacy |
| F-26 | Provider technician registers a device **for any facility** (facility picker) | `input_inventory.php` + `getClient` | **Partial** | after F-17 the technician switches to the facility tenant; no facility picker inside a tenant | S | F-17 |
| F-27 | Facility technician registers devices for **own** facility only | `inputInventoryClient` (facility fixed from mapping) | **Exists** | `HEALTHCARE TECHNICIAN` writes devices in own tenant. Upstream bug (facility id from the form, S-05) not ported | — | — |
| F-28 | Edit a device incl. **replacing photos** (old file removed) | `inventory_update`, edit modal in `inventory_list.php` | **Partial** | `PUT /api/v1/calibration-devices/:id` exists; photo replace = new attachment + soft-delete the old one (purge by `attachmentFileSweep`); audit before/after | S | F-25 |
| F-29 | Provider inventory list per facility: search over name, brand, type, QR, S/N, room, floor, condition, visit, dates; thumbnails; actions (upload, edit, calibration docs, IPM history, photos) | `inventorySKP`, `inventory_listSKP` | **Partial** | `dashboard/devices` list + filters for new fields; thumbnail column via signed attachment URLs (`/attachments/:id/signed`); server paging in `meta` | M | F-24, F-25 |
| F-30 | Facility (client) inventory list, read-only, own facility | `InventoryController::index/list` | **Exists** | `dashboard/devices` with read permission; add the new columns | S | F-24 |
| F-31 | Device-type search picker in forms | `getAlkes` (select2) | **Partial** | combobox on `GET /api/v1/device-types` | S | F-19 |

## E. Device Documents (M06)

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-32 | Upload a calibration document (PDF/DOCX/image ≤ 10 MB) to a device | `inventory_upload` (admin) | **Exists** | `POST /api/v1/attachments` (`resourceType: device`); folder `certificates-legacy` for imported PDFs (04 § 4.6) so lists can filter | S | — |
| F-33 | List and open a device's documents (provider and facility) | `inventory_detail`, `inventory_detail_client` | **Exists** | device detail drawer → attachments tab | — | — |
| F-34 | Admin deletes a document | `inventory_delete` (row only; file stays) | **Exists** | soft delete + purge sweep; audit | — | — |

## F. IPM Capture (M07)

> **Decided 2026-10-07 — ADR-126 (UD-6).** Many sessions per device; F-55's "409 on a second submission in the month" is **not** adopted — a monthly interval only flags a device *due* (computed). F-56 is the correction/void pattern of ADR-062: a correction is a new draft that supersedes the original on submit; a void names a reason and is final; results immutable after submit (trigger). Sessions and results carry `client_facility_id` (ADR-124).

> **Specified 2026-10-08 — P19-02 spec [`MEMORY/specs/P19-02-ipm-session-aggregate.md`](../../MEMORY/specs/P19-02-ipm-session-aggregate.md), ADR-126 Amendment 1 (target); its routes and columns supersede the paragraph below:** routes `GET/POST /api/v1/ipm/sessions`, `GET/PATCH /ipm/sessions/:sessionId`, `PUT …/results`, `POST …/{submit,discard,corrections,void}`, `GET /calibration-devices/:id/ipm-sessions`, `GET /ipm/due`; **no prefill route** (F-36: the draft create returns the prefilled draft); F-53: the room confirmed on the draft updates the device at submit; F-54: visit = max + 1 at the chain's first submit (imported history renumbered by date, upstream value kept); F-48/F-51: side effects per UD-12/UD-17 on entry only (§ 8 of the spec); every write `denyApiKey`, `Idempotency-Key` honoured.

All rows below share one new aggregate. Tables as in 04 § 4.8–4.9 (authoritative):
`inspection_sessions` (device, performer + snapshot, `performed_at`, `visit_number`,
`room_name_snapshot`, environment, `inspection_outcome`, `maintenance_outcome`, `recommendation`,
`notes`, `status` draft/submitted/voided; supersede/correction fields and the template version are
added in P19-02) and `inspection_results` (`section`, `item_definition_id` NULL, `item_label`,
`outcome` pass/fail/not_applicable/done/not_done, `cleanliness_outcome`, setting/reference/symbol,
measured values, `raw_value`, `sort_order`). **Routes** (gate `ipm`): `GET /api/v1/ipm/sessions`,
`POST /api/v1/ipm/sessions` (draft), `PUT /api/v1/ipm/sessions/:id` (draft only, else 409),
`POST /api/v1/ipm/sessions/:id/submit`, `POST /api/v1/ipm/sessions/:id/corrections`,
`POST /api/v1/ipm/sessions/:id/void`, `GET /api/v1/ipm/sessions/:id`. Each `:id` route gets a
two-tenant 404 test. **Page:** `frontend/src/app/dashboard/ipm` (list + history) and
`dashboard/ipm/new` (mobile-first stepper, one section per step, autosave draft).

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-35 | Start an IPM by choosing/scanning the device **QR** (facility technicians limited to their facility) | `getQrcode` (select2 over QR numbers) | **Missing** | QR scan via the camera (`BarcodeDetector` with a JS fallback loaded on demand under the CSP) or typed asset tag → `GET /calibration-devices?qrCode=` | M | F-23; camera permission UX |
| F-36 | Form pre-filled with device data (facility, name, brand, S/N, room) and the **type's checklist** | `getDataInventory` | **Missing** | `GET /api/v1/ipm/sessions/prefill?deviceId=` returns device + published template | M | F-20 |
| F-37 | Environment: room temperature (°C) and humidity (%) | section *Kondisi Lingkungan* | **Missing** | items `measured`, numeric with decimal-comma tolerant parsing (03 Q-22); plausibility warning (10–45 °C, 10–95 %) not a block | S | — |
| F-38 | Electrical supply: mains voltage; UPS and stabilizer voltage or N/A | *Kondisi Kelistrikan* | **Missing** | numeric or NA | S | — |
| F-39 | **Tools used** checklist (per type) + add an ad-hoc tool | *Alat Kerja yang Digunakan* | **Missing** | items from template; ad-hoc rows with `item_definition_id NULL`; later: link to our **reference standards/equipment** with their own calibration validity (ISO 17025 traceability — an improvement) | M | — |
| F-40 | Other safety: placement; wheels/trolley/bracket — Good / Not / N/A | *Pemeriksaan Keamanan Lain* | **Missing** | `tri_state` | S | — |
| F-41 | Physical inspection of main unit and accessories: Good / Light damage / Heavy damage + Clean / Dirty | *Pemeriksaan Fisik* | **Missing** | `condition_clean` | S | — |
| F-42 | **Electrical safety tests** (earth resistance, chassis leakage ×4, patient leakage ×5) with measured value shown against its limit; ad-hoc test | *Pemeriksaan Keamanan Listrik* | **Missing** | `measured_with_limit`; **compute pass/fail server-side** from `limit_op`/`limit_value`/unit (upstream leaves it to the reader) and keep the raw text when non-numeric (03 Q-23) | M | limit parsing; unit normalisation (µA, Ω) |
| F-43 | Completeness of accessories (per type) | *Kelengkapan Alat* | **Missing** | `tri_state` | S | — |
| F-44 | Function checks (per type) | *Pemeriksaan Fungsi Alat* | **Missing** | `tri_state` | S | — |
| F-45 | **Performance tests**: description, setting, reading 1, reading 2, reference value, Good/Not good; add rows | *Pemeriksaan Kinerja Alat* (modal "Tambah Kinerja Alat") | **Missing** | `setting_measured_reference`; prefill from template (upstream web ignored the template, D-05); optional computed deviation vs tolerance when the reference is numeric ± tolerance | M | free-text references ("± 10 %") |
| F-46 | Battery test (setting, readings, reference, result) | *Pemeriksaan Battery* — UI commented out; 448 legacy rows | **Partial** | expressible as a performance item in the template; no dedicated section | S | D-06 |
| F-47 | Overall inspection result: device works well / not | *Hasil Pemeriksaan* | **Missing** | `inspection_outcome` enum | S | — |
| F-48 | Preventive maintenance tasks done: clean main unit, clean accessories, monitor function, monitor performance, replace consumable part (free text), lubricate and/or tighten | *Pemeliharaan Alat* | **Partial** | maintenance work orders exist but have no task checklist; tasks as template items in section `maintenance_task`; on submit, create/close a `Preventative` work order (`maintenance.service.ts`) linked to the session | M | — |
| F-49 | Consumable stock status (name + available/empty) | *Stok Konsumabel* | **Missing** | session items; **optionally** link to our `stock` module when the consumable is a stocked item (later) | S | — |
| F-50 | Maintenance result: works well / not | *Hasil Pemeliharaan* | **Missing** | `maintenance_outcome` enum | S | — |
| F-51 | **Recommendation**: usable / needs calibration / not usable / must be repaired | *Rekomendasi Hasil Pekerjaan* (form codes 1, 0, -1, -2) | **Missing** | enum `fit_for_use`, `needs_calibration`, `not_fit_for_use`, `needs_repair` (04 § 4.8); on submit: `needs_repair` → open a `Repair` work order; `not_fit_for_use` → device status `maintenance`; `needs_calibration` → flag for `calibrationScheduler`. Each side effect audited in the same transaction | M | business-rule sign-off |
| F-52 | Free-text notes | *Catatan* | **Partial** | `notes` text; sanitized on render (S-07) | S | — |
| F-53 | Update the device's room during an IPM | `ipmSave` updates `trx_inventory.nama_ruangan` | **Partial** | snapshot `room_name_snapshot` on the session + optional device update with audit | S | — |
| F-54 | **Visit number** per device ("Visit ke: 001") | `trx_kondisi_lingkungan.visit` | **Missing** | computed server-side as count of submitted sessions per device + 1, stored at submit (upstream value unreliable, D-08) | S | — |
| F-55 | **One IPM per device per calendar month; a second save replaces the first** | `ipmSave` "update" mode | **Missing** | **do not port deletion.** A second submission in the same month returns **409** ("an IPM for this device in 2026-10 is already submitted — submit a correction") unless it is a correction; whether the monthly limit is a real business rule is an owner question | S | owner decision |
| F-56 | **Edit a past IPM, including moving it to another date** | `editIPM`, `ipmEditSave` (delete + re-insert) | **Partial** | our pattern exists for calibration records (`/corrections`, `/void`, `supersedes_id`) — reuse it: a correction creates a new version with a reason; the original stays readable. Date change = correction | M | F-55; training (Phase 29) |
| F-57 | **IPM history per device** (dates, view, edit, download) | `inventory_datatable_ipm`, modal in dashboard/inventory | **Missing** | device detail → "IPM" tab: `GET /api/v1/ipm/sessions?deviceId=` | S | — |

## G. IPM Report (M08)

> **Decided 2026-10-07 — ADR-126 § 8 (the owner's rule: certificates and exports are rendered in the frontend; no certificate or export file is stored).** F-58 … F-60 are a **frontend renderer** fed by a data document from the API, with the hash/QR discipline of the certificate document (ADR-095 §4, ADR-107) — not `GET /certificates/:id/pdf` of a stored PDF and not a backend PDF. Print/download is the browser's. F-61 stays with UD-17. **Specified 2026-10-08 — P19-06 spec, ADR-126 Am. 2:** the report is a document **of the submitted session** (number `IPM-<facility code>-<YYYYMMDD>-<NNN>`, required verification token, stored content hash `ipm-report-v1`, issuer snapshot) — **not** a certificate row; signatures in the facility-scoped `inspection_session_signatures`; public verification `GET /ipm/verify/:reportNumber?token=` and the page `/verify/ipm/[reportNumber]`.

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-58 | **IPM report** layout: header (IPM title, device name, provider logo), identity block, "Visit ke", all sections in two columns, results, notes, signature lines for technician (name) and IPSRS | `ipm/pdf_ipm.php` | **Missing** | new template on the certificate pipeline: certificate `type: "maintenance"` already exists; ~~render HTML → PDF with puppeteer (`certificatePdf.service.ts`)~~ **corrected 2026-10-07:** the backend renders no PDF (ADR-095) and no report file is stored (owner rule) — the frontend renders it with jsPDF from a data document, A4 landscape (see `09-REPORT-LAYOUTS.md` § 2.5); **issue once at submit** (`certificateNumber`, ~~stored file~~, `verificationToken`, QR to `/verify/…`); provider branding from the provider tenant's logo/colour | **L** | Phase 23 parity sign-off |
| F-59 | Download the IPM report as PDF | `downloadSertifikatIPM` | **Missing** | ~~`GET /api/v1/certificates/:id/pdf` reuse~~ **2026-10-08 (P19-06):** the browser renders the PDF from `GET /ipm/sessions/:sessionId/report-document?render=pdf` (the read audited as `EXPORT`); nothing stored | S | F-58 |
| F-60 | Print preview button (hidden in PDF) | `pdf_ipm.php` `window.print()` | **Missing** | ~~browser preview of the stored PDF~~ **2026-10-08 (P19-06):** the on-screen report page (the accessible version) and the rendered PDF; a draft previews with a "DRAFT — NOT A RECORD" watermark, offline too | S | F-58 |
| F-61 | Countersignature by technician and IPSRS | wet signature on paper | **Missing** | **improvement:** ~~`eSignature` workflow (technician signs on submit, …)~~ **2026-10-08 (P19-06, ADR-126 Am. 2):** the technician signs **after** the submit is accepted, online, with a re-entered credential (never in the offline outbox); the facility's `FACILITY MAINTENANCE` countersigns after it (tenant setting `ipm.countersignEnabled`, never the submitter); rows in `inspection_session_signatures`, not `e_signature_records`; a wet-signature line stays printable — 21 CFR Part 11 § 11.50/11.70/11.200 | M | IPSRS accounts only where a facility countersigns electronically |

## H. Calibration Date Recording (M09)

> **Specified 2026-10-08 — P19-05 spec [`MEMORY/specs/P19-05-calibration-dates.md`](../../MEMORY/specs/P19-05-calibration-dates.md), ADR-133 (target).** F-62: `POST /api/v1/calibration-devices/:id/calibration-dates` (after the QR lookup) records an `external_date` record — laboratory, certificate number, stated next date, verdict — and **no file** (owner rule: no certificate file stored); history kept. The device's next due date is derived from its latest **effective** record on create, correction and void (today's code moves it backward on an older record — fixed). F-63/F-69: `GET /calibration-records?latestOnly=true`. F-64: UD-8's interim rule — `tgl_kalibrasi` is not a record; OA-7 decides.

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-62 | Record a device's calibration date by QR (room confirmed; latest technician recorded; overwrite) | `input_kalibrasi.php` form, `kalibrasiSave` | **Partial** | "quick external calibration" = `POST /api/v1/calibration-records` with `calibrationDate`, `performedBy`, `standard: external lab`, optional certificate attachment; **history kept** (no overwrite); due date from `calibrationIntervalDays` | S | 03 Q-11 (two calibration dates) |
| F-63 | Calibration list per facility with latest calibration date and technician, search | `kalibrasi_listSKP` | **Partial** | `dashboard/calibration` list with "latest per device" view | S | — |
| F-64 | Calibration date typed at device registration | `trx_inventory.tgl_kalibrasi` | **Partial** | map to a legacy calibration record or `nextCalibrationDate` per SME decision | S | 03 Q-11 |

## I. Reports and Exports (M10)

> **Decided 2026-10-07 — ADR-126 § 8 (owner's rule).** F-65 … F-69 are generated **in the browser** from paginated API reads (PDF and XLSX alike): no `?format=xlsx` on the backend, no batch job writing an export file, no stored export. A large facility is exported page by page with progress shown. Under ADR-124 a facility-bound user exports only their facility (the reads are scoped), and a provider's "optional facility" filter is a query parameter of an unbound read, not a security boundary.

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-65 | **Inventory PDF** per facility, A3 landscape, photo thumbnails (or "without photos"), signature blocks for provider and facility | `inventory_download_admin`, `ipm/pdf_admin.php` | **Partial** | **corrected 2026-10-07 (owner rule: exports rendered in the frontend, no stored file) — see `09-REPORT-LAYOUTS.md` § 3.3, § 5; the backend proposal that follows is superseded:** `GET /api/v1/reports/inventory?format=pdf&photos=true|false` → enqueue a **batch job** (`batchJobs`) for large facilities (upstream exhausts 512 MB), stream the result as an attachment; thumbnails from stored thumbnails, not resized per request | M | F-25 thumbnails |
| F-66 | **Inventory XLSX** (14 columns incl. latest calibration date, technician, photo links) | `inventory_download_admin_xls` | **Partial** | **corrected 2026-10-07: XLSX written in the browser from paged API reads, no backend XLSX — `09-REPORT-LAYOUTS.md` § 4.3; superseded:** `?format=xlsx` beside csv in `reporting.controller.ts`; add a streaming XLSX writer dependency (owner allows package swaps); photo links as signed, expiring URLs — **not** permanent public URLs | S | dependency review |
| F-67 | Facility's own inventory PDF | `inventory_download` | **Partial** | same as F-65, own tenant | S | F-65 |
| F-68 | **Calibration recaps XLSX**: (a) by input date, (b) by calibration date, (c) input-date range, (d) calibration-date range; optional facility | `kalibrasi_download_harian_xls`, `…_by_tgl_kalibrasi_xls`, `…_rentang_input_xls`, `…_rentang_kalibrasi_xls` | **Partial** | one endpoint `GET /api/v1/reports/calibrations?dateField=created|calibrated&from=&to=&format=xlsx|csv`; for provider staff across tenants, a per-tenant export or a provider roll-up (needs F-17 and an explicit cross-tenant reporting decision) | M | F-17; cross-tenant reporting must not bypass the hooks |
| F-69 | Calibration list export (latest per device) | `kalibrasi_download_admin_xls` | **Partial** | covered by F-68 with `latestOnly=true` | S | — |

## J. Dashboard and Lists (M11, M12)

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-70 | Cards: total devices, good, broken (with % and progress bar) + donut chart + summary, scoped to the facility | `DashboardController::index`, `dashboard/index.php` | **Partial** | extend `GET /api/v1/dashboard/metrics` with condition counts; chart with theme tokens; **"fit" counts as good** (D-03) | S | F-24 |
| F-71 | Drill-down from each card to a device list with buttons (calibration docs, IPM history, photos) | `details/(:alphanum)` | **Partial** | link to `dashboard/devices?condition=` | S | F-57 |
| F-72 | Quick search by name, brand, type, QR | dashboard search box | **Exists** | global `search` route; add `qr_code` to the index | S | F-23 |
| F-73 | Technician activity list: IPM sessions with facility, device, QR, S/N, technician, IPM date, condition; search | `TeknisiController` | **Partial** | `dashboard/ipm` list with filters `performedBy`, date range; provider roll-up depends on F-17 | S | F-57 |

## K. Public QR Page (M13)

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-74 | **Public device page by QR**: device identity, facility, photos, links to calibration documents and to each IPM | `FaskesController::readQr` | **Partial** | public certificate verify exists. New `GET /api/v1/public/devices/:token` (no auth, rate-limited like `verifyBudget`) where `token` is a random, revocable capability (≥128-bit) printed in **new** QR stickers; tenant setting controls what is shown (default: identity + calibration status + last IPM date; photos and documents off). Page `frontend/src/app/d/[token]` under the public CSP; route on the reviewed exemption list (`routeGateExemptions.ts`) as "capability-token" | M | privacy decision; Phase 27 legacy stickers |
| F-75 | Public IPM report view and PDF by QR + date | `ipm/getIPM`, `downloadSertifikatIPM` | **Partial** | replaced by ~~the certificate verify page~~ **the IPM report verification page `/verify/ipm/<number>?t=<token>`** (P19-06 § 9; token required) of the issued IPM report (F-58) — reachable from F-74, never by a guessable number | S | F-58 |
| F-76 | Legacy QR continuity: existing stickers keep resolving | implicit (stickers in the field) | **Missing** | if stickers encode a URL on the old host, keep a redirect service mapping `SKPnnnnnn` → the device's capability token (rate-limited, showing only the minimal public view). If they encode only the number, a technician lookup inside the app suffices | S | **unknown sticker content — owner to scan one** |

## L. Mobile API and App (M14)

> **Decided 2026-10-07 — ADR-127 (UD-14).** PWA, no native app (F-77 retired at cutover, P28-03). F-78: per-user encrypted IndexedDB outbox replaying the **normal** API with `Idempotency-Key` headers and a ~~per-tenant~~ **per-creator** `client_ref` (ADR-126 Am. 1); conflicts are 409/404 with a reason; no batch endpoint. F-79 as written (ETag, ADR-125 § 6). **Specified 2026-10-08 — P19-08 spec, ADR-127 Am. 1:** the field app is one document `/field` with the worker scoped to `/field`; ops planned from the local capture and frozen before sending; purge on a failed refresh and on scope-loss codes.

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-77 | Native Android app with JWT login | APK + `api_v1/loginUser` | **N/A** | not ported as-is; Phase 28 decides PWA vs native | — | — |
| F-78 | **Offline batch upload of devices and IPMs** from the field | `insert_inventory`, `insert_ipm` (arrays) | **Missing** | if PWA: IndexedDB queue of drafts + photos, background sync to the normal endpoints with idempotency keys; conflict = 409 with explanation | **L** | Phase 28; intermittent connectivity in facilities |
| F-79 | Download the checklist catalogue for offline use | `data_ipm` | **Missing** | `GET /api/v1/ipm/templates/published` with ETag | S | F-20 |

## M. Not Adopted (M15 and unsafe behaviours)

| ID | Feature | Upstream — where / how | Status | Implementation notes | Size | Deps / risks |
|---|---|---|---|---|---|---|
| F-80 | Debug dump of all devices | `recall` | **N/A** | not adopted | — | — |
| F-81 | Server information page; permission-menu screen residue ("Budget Company", "Promo Card") | `info.php`; `masterData/group.php`, `admin/roleGroup.php` | **N/A** | not adopted | — | — |

---

## Status Tally

| Status | Count | Features |
|---|---:|---|
| **Exists** | 17 | F-01, F-02, F-04, F-06..F-12, F-16, F-27, F-30, F-32, F-33, F-34, F-72 |
| **Partial** | 29 | F-13, F-14, F-15, F-18, F-19, F-23, F-24, F-26, F-28, F-29, F-31, F-46, F-48, F-52, F-53, F-56, F-62..F-71, F-73, F-74, F-75 (F-72 is Exists) |
| **Missing** | 30 | F-17, F-20, F-21, F-22, F-25, F-35..F-45, F-47, F-49, F-50, F-51, F-54, F-55, F-57, F-58..F-61, F-76, F-78, F-79 |
| **N/A** | 5 | F-03, F-05, F-77, F-80, F-81 |
| **Total** | **81** | Three upstream *behaviours* are replaced rather than ported and are recorded inside the feature that supersedes them: guessable public QR access (F-74/F-75), delete-and-reinsert edits (F-56), API attribution from the request body (F-78) |

## Top Gaps (ordered by dependency, not by size)

1. **F-17 provider multi-tenant access** — without it a provider technician cannot work for 118
   facilities. ADR first.
2. **F-19..F-22 catalogue and versioned templates** — every IPM depends on them.
3. **F-35..F-57 IPM aggregate** — the core of the upstream, absent here.
4. **F-58..F-61 IPM report** — ~~on our certificate pipeline~~ issued with the session (ADR-126 Am. 2), verifiable and signed.
5. **F-23..F-25 device asset tag, condition and photos**.
6. **F-65..F-69 PDF/XLSX exports** as batch jobs.
7. **F-74..F-76 public device page** with capability tokens + legacy sticker continuity.
8. **F-78 offline capture** decision.
