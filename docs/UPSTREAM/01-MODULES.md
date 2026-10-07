# 01 — Upstream Modules and Their Mapping to Callibrator

> **Ringkasan (Bahasa Indonesia).** Kode upstream (11 controller, 30 model, ±40 view) dikelompokkan
> menjadi **15 modul fungsional**. Di Callibrator: **3 modul sudah ada** (autentikasi, pengguna &
> peran & profil, dokumen alat), **8 sebagian** (faskes/tenant, katalog jenis alat, inventaris alat,
> kalibrasi, laporan & ekspor, dashboard, aktivitas teknisi, halaman QR publik), **2 belum ada**
> (formulir **IPM** dengan template ceklis per jenis alat, dan **laporan IPM**), dan **2 tidak
> diadopsi** dalam bentuk aslinya (API mobile + APK — kemampuan *offline capture*-nya diputuskan di
> UP-16 — dan sisa kode debug/phpinfo). Celah terbesar: (1) IPM dan template ceklisnya, (2) model "satu penyedia jasa melayani
> banyak faskes" — di Callibrator satu pengguna hanya punya satu tenant.

**Status:** research, 2026-10-07. Statuses: **Exists** (we do it, maybe differently) · **Partial**
(the concept exists, named gaps) · **Missing** · **N/A** (not adopted as-is). Every Callibrator file
named below exists in the repository on 2026-10-07. Feature-level detail and implementation notes
are in [`02-FEATURES.md`](./02-FEATURES.md); feature ids `F-nn` refer there.

Role abbreviations (upstream groups): **A** = `admin` (provider admin) · **T** = `user` (provider
technician) · **C** = `client` (facility, read-only) · **FT** = `teknisi_client` (facility technician)
· **Pub** = anonymous.

## Summary

| # | Module | Upstream size | Callibrator equivalent | Status |
|---|---|---|---|---|
| M01 | Authentication | myth/auth + 2 views | `auth` routes, `frontend/src/app/login`, `forgot-password` | **Exists** |
| M02 | User, group & profile administration | `AdminController`, `Group`, 8 views | `user`, `roles`, `menuGroups`, `userPermissions`; `dashboard/users`, `roles`, `profile` | **Exists** |
| M03 | Client facilities (faskes) & client-user mapping | `FaskesController` (index/save/accountEdit), `AdminController::mappingUserClient*` | `tenant` (+ `tenantHierarchy`); `dashboard/tenants` | **Partial** |
| M04 | Device-type catalogue & IPM checklist templates | 15 `mst_*` + 5 `mapping_*` tables, 12 seeders, no UI | `calibrationDevice.category` (free string) | **Partial** (catalogue) / **Missing** (templates) |
| M05 | Device inventory (registration, QR, photos, lists, edit) | `InventoryController` (~600 lines), 5 views | `calibrationDevices` route/service, `dashboard/devices` | **Partial** |
| M06 | Device documents (calibration certificate files) | `inventory_upload/detail/delete` | `attachments` (resource `device`) | **Exists** |
| M07 | **IPM capture** (inspection & preventive maintenance) | `IpmController` (~800 lines), 16 `trx_*` tables, 2 large views | `maintenance` (work orders) only | **Missing** |
| M08 | **IPM report** (HTML/PDF) | `ipm/pdf_ipm.php`, `htmlToPDF`, `downloadSertifikatIPM`, `getIPM` | `certificatePdf.service.ts` (calibration certificates only) | **Missing** |
| M09 | Calibration date recording | `IpmController::inputKalibrasi/kalibrasiSave/kalibrasi_listSKP`, `trx_kalibrasi` | `calibrationRecords` + `certificates` (far richer) | **Partial** |
| M10 | Reports & exports (PDF/XLSX) | 9 export endpoints | `reports` (JSON + CSV) | **Partial** |
| M11 | Dashboard | `DashboardController` | `dashboard` metrics, `frontend/src/app/dashboard/page.tsx` | **Partial** |
| M12 | Technician activity view | `TeknisiController` | `audit`, calibration record lists | **Partial** |
| M13 | Public QR device page & public IPM | `FaskesController::readQr/getIPM`, `downloadSertifikatIPM` | public certificate verify (`certificates` `/verify/:certificateNumber`, `frontend/src/app/verify`) | **Partial** |
| M14 | Mobile API (JWT) & Android app | `Apiuser`, `AuthFilter`, `mst_foto*_inventory`, APK | `apiKeys`, REST API, `attachments`, `calibrationDevices/bulk-import` | **N/A** as-is (capability decision UP-16) |
| M15 | Platform residue (debug, phpinfo, template leftovers) | `recall`, `info.php`, `group.php` residue | — | **N/A** (do not adopt) |

Totals: **Exists 3** (M01, M02, M06) · **Partial 8** (M03, M04, M05, M09, M10, M11, M12, M13 — M04 counted once, as Partial, although its template half is Missing) · **Missing 2** (M07, M08) · **N/A 2** (M14, M15) = 15.

---

## M01 — Authentication

| | |
|---|---|
| Purpose | Session login for every web user |
| Code | `vendor/myth/auth` `AuthController` (login, attemptLogin, logout, register, attemptRegister, forgotPassword, attemptForgot, resetPassword, attemptReset, activateAccount); `app/Views/auth/login.php`, `register.php`; config edited in `vendor/myth/auth/src/Config/Auth.php` |
| Tables | `users`, `auth_logins`, `auth_tokens`, `auth_reset_attempts`, `auth_activation_attempts` |
| Roles | Pub |
| Business rules | login by username **or** email; password ≥ 6; registration open and auto-active; remember-me disabled; reset by emailed token (myth) |
| Callibrator | `backend/src/routes/api/auth.route.ts`, `authPublic.route.ts`, `services/auth.service.ts`; `frontend/src/app/login`, `forgot-password`, `activation`, `invitation`, `request-access`; MFA/WebAuthn/OIDC/SCIM beyond upstream |
| Status | **Exists** |
| Gap | none to adopt. Self-registration is **deliberately not adopted** (F-03, S-04); onboarding goes through invitation / request-access. Migrated users cannot keep their passwords unless we accept myth's `bcrypt(base64(sha384))` scheme — see F-01 notes |

## M02 — User, Group and Profile Administration

| | |
|---|---|
| Purpose | Provider admins manage accounts, groups and their own profile |
| Code | `AdminController::index/detail/userRegister/mappingUser/mappingUserSave/groupSave/editProfile/editProfileSave/resetPasswordForm/adminResetPassword`; `Group::index/groupSave/groupEdit`; views `admin/*`, `masterData/group.php` |
| Tables | `users`, `auth_groups`, `auth_groups_users` |
| Roles | A (all); every logged-in user: own profile (non-admins: password only) |
| Business rules | a user's group is set by "Mapping User" (one form, `addUserToGroup`); admin can reset another user's password (confirm field must match); only admins may change name/email/username/photo on their own profile |
| Callibrator | `routes/api/user.route.ts` (`/create`, `/edit`, `/:userId/password/reset`, `/:userId/avatar`), `roles.route.ts` (`/assign`), `menuGroups.route.ts`, `userPermissions.route.ts`; `services/user.service.ts`, `roles.service.ts`; pages `dashboard/users`, `roles`, `permissions`, `user-permissions`, `profile`, `change-password` |
| Status | **Exists** |
| Gap | role **mapping** of the 4 groups (UP-06): `admin`→`CALIBRATOR ADMIN`, `user`→`TECHNICIAN`, `client`→`HEALTHCARE ADMIN` (read-mostly) or `ROOM USER`/`USER` per facility choice, `teknisi_client`→`HEALTHCARE TECHNICIAN`. "Groups" CRUD maps to our roles admin, which is platform-level (roles are global, ADR-064) — provider admins should **not** create roles |

## M03 — Client Facilities (Faskes) and Client-User Mapping

| | |
|---|---|
| Purpose | The provider's customer list; tie each facility account to one facility |
| Code | `FaskesController::index/save/accountEdit` (list paged 5, search by name, add name/phone/address/logo-name, rename); `AdminController::mappingUserClient/mappingUserClientSave/mappingUserClientEdit`; `InventoryController::getClient` (select2 search); `TrxMappingUserClient` |
| Tables | `mst_faskes`, `trx_mapping_user_client` |
| Roles | A |
| Business rules | a client/facility-technician account maps to **exactly one** facility (data: 60 mappings, none multiple); provider staff are never mapped and see all facilities |
| Callibrator | `routes/api/tenant.route.ts` (`/create`, `/edit`, `/settings`, `/:tenantId/logo`), `tenantHierarchy.route.ts`, `services/tenant.service.ts`, `tenantHierarchy.service.ts`; `dashboard/tenants`, `tenant-hierarchy` |
| Status | **Partial** |
| Gap | (1) facilities become **tenants**, created by the platform operator, not by a provider admin; (2) **provider staff serving many tenants does not exist** — a user has one `tenantId` (§ 10 of 00); (3) district-office → health-centre structure is in the device "room" field upstream; could become `tenant_hierarchies` (structure only) or warehouses/locations inside one tenant — ETL decision |

## M04 — Device-Type Catalogue and IPM Checklist Templates

| | |
|---|---|
| Purpose | A global list of device types (344) and, per type, which checklist items apply in an IPM |
| Code | models `AlatKesehatanModel` (`mst_alat`), `Mapping{AlatKerjaDigunakan,FungsiAlat,KeamananListrik,KelengkapanAlat,KinerjaAlat}`; seeders `MasterAlat`, `MasterIPM`, `Master*`, `Mapping*`; lookups `getAlkes`, `getAlkesEdit`; consumers `IpmController::getDataInventory`, `Apiuser::data_ipm` |
| Tables | `mst_alat`; item catalogues `mst_alat_kerja_digunakan` (42 tools), `mst_pemeriksaan_fungsi_alat` (155), `mst_kelengkapan_alat` (93), `mst_pemeriksaan_keamanan_listrik` (10, each with a limit e.g. "≤ 100 µA"), `mst_pemeriksaan_kinerja_alat` (184, with setting and reference value); global sections `mst_kondisi_lingkungan`, `mst_kondisi_kelistrikan`, `mst_pemeriksaan_keamanan_lain`, `mst_pemeriksaan_fisik`, `mst_pemeliharaan_alat`, `mst_rekomendasi_hasil_pekerjaan`, `mst_stok_konsumable` (empty); mappings `mapping_*` |
| Roles | read by A/T/FT; **no write UI** (seeders and direct SQL only) |
| Business rules | each item carries `status` (allowed codes as text, e.g. `0,1,-1`) and `notes` (code meanings); technicians may add ad-hoc items in the form that are saved as free text and never enter the catalogue |
| Callibrator | `calibrationDevice.category` (string, `backend/src/models/calibrationDevice.model.ts`); `calibrationRecord.results` JSONB; no template concept |
| Status | **Partial** (a category string exists) / **Missing** (templates) |
| Gap | a **global, versioned checklist-template model** (platform-owned, tenant may extend) with typed items (boolean, tri-state, measured value + limit, setting/measured/reference); a catalogue admin UI; the IPM form must snapshot the template version used. See F-19..F-22 |

## M05 — Device Inventory

| | |
|---|---|
| Purpose | Register every device of a facility with its QR sticker number and two photos; list, search, edit |
| Code | `InventoryController::inputInventory/inventorySave` (provider technician, chooses facility), `inputInventoryClient/inventorySaveClient` (facility technician), `index/list` (client list), `inventorySKP/inventory_listSKP` (provider list with facility picker, thumbnails, edit modal), `inventory_update` (edit + photo replace); views `inventory/*` |
| Tables | `trx_inventory` (+ `mst_alat`, `mst_faskes`) |
| Roles | create: T (any facility), FT (own facility); edit: A, T; list: all (scoping in § S-05 of 00) |
| Business rules | QR normalised to `SKP` + 6 digits and **globally unique** (checked before saving); front photo and serial-plate photo **mandatory**; device name copied from the chosen type at registration (snapshot); condition `Baik`/`Tidak Baik` (data also has `Laik`, `Rusak`); accessories `Ada`/`Tidak Ada`; inventory date, calibration date and calibration lab typed by hand; room and floor are free text |
| Callibrator | `routes/api/calibrationDevices.route.ts` (`GET/POST /`, `GET/PUT/DELETE /:calibrationDeviceId`, `/restore`, `/reinstate`, `/bulk-import` CSV), `services/calibrationDevices.service.ts`; `frontend/src/app/dashboard/devices`; `locationId` → `warehouses` |
| Status | **Partial** |
| Gap | QR field (`qr_code`) with per-tenant uniqueness and normalisation (04 § 4.2); photo slots (front, serial plate) on top of attachments; condition, accessories, floor/room, inventory date, calibration lab fields (or a mapped home for each); "registered by"; thumbnails in the list. Our `UNIQUE (tenant_id, serial_number)` conflicts with 624 duplicate-serial groups (03 Q-18) |

## M06 — Device Documents

| | |
|---|---|
| Purpose | Keep the external lab's calibration certificate (PDF) per device |
| Code | `InventoryController::inventory_upload` (A), `inventory_detail` (list + delete button for A), `inventory_detail_client` (C), `inventory_delete` (A; deletes the row, not the file) |
| Tables | `trx_inventory_file` |
| Roles | upload/delete A; view A/T/C |
| Business rules | ≤ 10 MB; jpeg/jpg/png/docx/pdf; random stored name |
| Callibrator | `routes/api/attachments.route.ts`, `services/attachment.service.ts`, `constants/attachmentResources.ts` (`device` → `CalibrationDevice`), storage module (`services/storage`, local/S3/NFS); `dashboard/attachments` |
| Status | **Exists** |
| Gap | a "calibration certificate" purpose/folder on the device attachment, and the client read view on the device page; ETL of 11.9k PDFs (03 § 6) |

## M07 — IPM Capture (Inspection & Preventive Maintenance)

| | |
|---|---|
| Purpose | The core of the upstream: one structured on-site inspection + preventive maintenance of one device |
| Code | `IpmController::inputMaintenance`, `getQrcode` (QR picker; facility technicians only see their facility), `getDataInventory` (device + type templates + "already done this month" flag + visit flag), `ipmSave` (validate 5 mandatory sections, transaction, month-replace, insert 16 sections, update room), `editIPM`, `getDataInventoryEditIPM`, `ipmEditSave` (delete the session's rows by date and re-insert, optionally on a new date); `InventoryController::inventory_datatable_ipm` (history per device); views `ipm/input_maintenance.php` (1,164 lines of jQuery-built form), `ipm/editIPM.php` |
| Tables | `trx_kondisi_lingkungan` (also holds `visit`), `trx_kondisi_kelistrikan`, `trx_alat_kerja_digunakan`, `trx_pemeriksaan_keamanan_lain`, `trx_pemeriksaan_fisik`, `trx_keamanan_listrik`, `trx_kelengkapan_alat`, `trx_fungsi_alat`, `trx_kinerja_alat`, `trx_battery`, `trx_hasil_pemeriksaan`, `trx_pemeliharaan_alat`, `trx_konsumabel`, `trx_hasil_maintenance`, `trx_rekomendasi_hasil_pekerjaan`, `trx_catatan` |
| Roles | T, FT (create/edit); A/T/C view history |
| Business rules | **one IPM per device per calendar month** — a second save in the same month replaces the first; 5 mandatory sections (environment, electrical supply, tools, other safety, physical); measured electrical-safety values are shown next to their limit **without automatic pass/fail**; performance rows carry setting, two readings, reference value and a manual Good/Not good; overall result, maintenance result and recommendation are single choices; the IPM can update the device's room |
| Callibrator | `routes/api/maintenance.route.ts` + `services/maintenance.service.ts` (work orders: Preventative/Breakdown/Repair, status, priority, vendor, cost); `calibrationRecords` (results JSONB, corrections, void); `predictiveMaintenance`, `calibrationScheduler` (due dates) |
| Status | **Missing** |
| Gap | the whole IPM aggregate: session header + typed section results + template snapshot, immutable after submission with **corrections/supersede** (our calibration-record pattern) instead of delete/re-insert; link to a preventive work order and to the device status (recommendation → `maintenance`/`retired`/needs calibration). See F-35..F-57 |

## M08 — IPM Report

| | |
|---|---|
| Purpose | The printable one-page result of an IPM, given to the facility |
| Code | `InventoryController::getDataIPM/htmlToPDF/downloadSertifikatIPM/inventory_ipm`, `FaskesController::getIPM`; views `ipm/pdf_ipm.php` (current), `ipm/index.php` (older on-screen version incl. battery), `ipm/pdf_ipm copy.php` (dead) |
| Tables | the 16 IPM tables + `trx_inventory`, `mst_faskes`, `mst_alat`, `users` |
| Roles | login (any) / **public** for download (S-06) |
| Business rules | rendered from live rows each time; signature lines for the technician (name printed) and IPSRS (blank) |
| Callibrator | `services/certificatePdf.service.ts`, `certificateDocument.service.ts`, `certificate.service.ts` (numbering, submit/approve/sign/revoke, verification token), `frontend/src/lib/certificatePdf.ts`, `frontend/src/app/verify/[certificateNumber]` |
| Status | **Missing** |
| Gap | an IPM report template on the certificate pipeline (type `maintenance` already exists in the certificate `type` enum), issued once and stored, with QR verification and e-signature of the technician and IPSRS. See F-58..F-61 |

## M09 — Calibration Date Recording

| | |
|---|---|
| Purpose | Record when a device was calibrated (by an external lab) and by which provider staff |
| Code | `IpmController::inputKalibrasi` (page), `kalibrasiSave` (upsert per device), `kalibrasi_listSKP` (list with latest date + technician); `trx_inventory.tgl_kalibrasi` (typed at registration) |
| Tables | `trx_kalibrasi`, `trx_inventory` |
| Roles | A, T |
| Business rules | one row per device, overwritten ("latest technician wins"); two different "calibration dates" coexist (03 Q-11) |
| Callibrator | `routes/api/calibrationRecords.route.ts`, `services/calibrationRecords.service.ts` (date, due date, standard, results, uncertainty, compliance, corrections, void); `certificates`; `calibrationScheduler` (`/due`, `/run`); `dashboard/calibration`, `calibration-scheduler` |
| Status | **Partial** (ours is a superset) |
| Gap | a "quick record calibration date" entry (by QR) for externally calibrated devices, with the PDF attached; history kept instead of overwritten |

## M10 — Reports and Exports

| | |
|---|---|
| Purpose | Hand facility lists and calibration recaps to the facility and to provider management |
| Code | `InventoryController::inventory_download` (client PDF), `inventory_download_admin` (PDF with thumbnails / without photos), `inventory_download_admin_xls`, `kalibrasi_download_rentang_input_xls`, `kalibrasi_download_rentang_kalibrasi_xls`; `IpmController::kalibrasi_download_admin_xls`, `kalibrasi_download_harian_xls`, `kalibrasi_download_by_tgl_kalibrasi_xls`; views `ipm/pdf_admin.php`, `ipm/pdf.php` |
| Roles | A (most); C (own PDF); any logged-in user in practice (S-04/S-05) |
| Callibrator | `routes/api/reports.route.ts` (`/summary`, `/compliance`, `/calibration-workload`, `/overdue-devices`, `/inventory`; `?format=csv`), `services/reporting.service.ts`, `dashboard/reports` |
| Status | **Partial** |
| Gap | XLSX output; PDF inventory list with photo thumbnails and signature blocks; calibration recaps by input date / calibration date / ranges; large-facility generation as a **batch job** (`batchJobs`) rather than a request (upstream runs out of memory). See F-65..F-69 |

## M11 — Dashboard

| | |
|---|---|
| Code | `DashboardController::index/details`; view `dashboard/index.php` (quick search, 3 cards, donut, summary, drill-down modals with calibration-document and IPM lists) |
| Roles | all (client scoped to own facility; others see all facilities) |
| Callibrator | `routes/api/dashboard.route.ts` (`/metrics`), `services/dashboard.service.ts`, `dashboardCache.service.ts`; `frontend/src/app/dashboard/page.tsx`; global `search` |
| Status | **Partial** |
| Gap | condition dimension (good / not good) on devices and its drill-down; fix D-03 semantics ("Laik" is good) |

## M12 — Technician Activity View

| | |
|---|---|
| Code | `TeknisiController::index/list` — IPM sessions with facility, device, QR, S/N, technician name, IPM date, condition, photos; search |
| Callibrator | `audit` (`dashboard/audit`), calibration-record lists filtered by `performedBy`, maintenance work orders by `assignedTo` |
| Status | **Partial** |
| Gap | an "IPM sessions" list filterable by technician/date/facility (falls out of M07) |

## M13 — Public QR Device Page and Public IPM

| | |
|---|---|
| Code | `FaskesController::readQr` (raw HTML: provider header, device name, facility, brand, type, room, S/N, photos, buttons to each calibration document and each IPM), `getIPM` (public IPM HTML), `InventoryController::downloadSertifikatIPM` (public PDF — no filter) |
| Roles | **Pub** |
| Callibrator | public certificate verification `GET /api/v1/certificates/verify/:certificateNumber` (+ `/document`), `frontend/src/app/verify/[certificateNumber]`, rate-limited (`verifyBudget`) |
| Status | **Partial** |
| Gap | a public **device** page reached by an unguessable token in the QR (not the sequential number), showing only what the facility allows; legacy sticker continuity (UP-15) |

## M14 — Mobile API (JWT) and Android App

| | |
|---|---|
| Code | `Apiuser::login/details/faskes/alat_kesehatan/inventory/upload_foto/data_ipm/trx_ipm/getInventory`; `App\Filters\AuthFilter`; models `InventoryModel`, `InventoryFotoDepanModel`, `InventoryFotoSNModel`; `public/skpipm-*.apk` |
| Tables | `mst_fotodepan_inventory`, `mst_fotosn_inventory` (photo upload log, 480 each) + inventory and IPM tables |
| Callibrator | REST API with API keys (`apiKeys`), OpenAPI contracts (`*.openapi.ts`), `attachments`, `calibrationDevices/bulk-import`, rate limits, webhooks |
| Status | **N/A** as-is |
| Gap | the **offline field capture** capability — decide in UP-16 (PWA with an offline queue vs a native app on our API). The upstream API itself is not ported (S-10, S-11, dead routes) |

## M15 — Platform Residue

`IpmController::recall` (debug dump), `mozivid/skpipm.id/info.php` (phpinfo), `masterData/group.php`
and `admin/roleGroup.php` permission-menu residue, `Views/InventoryController.php`,
`ipm/pdf_ipm copy.php`, `views_ipm.rar`, `inventory_download_admin_xls_off`. **N/A — not adopted.**

---

## Role Mapping (draft for UP-06)

| Upstream group | Proposed Callibrator role | Tenant | Notes |
|---|---|---|---|
| `admin` | `CALIBRATOR ADMIN` | provider staff, member of each served facility tenant (00 § 10 option 1) | user/role admin stays with the platform/tenant admins |
| `user` (Teknisi) | `TECHNICIAN` | same membership | IPM write, device write, calibration-date write |
| `client` | `HEALTHCARE ADMIN` (if the facility runs its own users) or a read-only facility role | the facility tenant | upstream client is read-only; decide whether facilities get write |
| `teknisi_client` | `HEALTHCARE TECHNICIAN` | the facility tenant | device registration + IPM in own facility |
| (signature) IPSRS | `FACILITY MAINTENANCE` | the facility tenant | **new duty**: countersigns the IPM report electronically (upstream: wet signature) |

Proposed new menu slug for gates: `ipm` (IPM capture/report) and `ipm-templates` (catalogue admin,
platform-owned); device extensions stay under `equipment`; exports under the existing reports gate.
