# 00 — Upstream Overview (`apps-ipm`, CodeIgniter 4)

> **Ringkasan (Bahasa Indonesia).** Aplikasi upstream adalah **SKP IPM** — aplikasi web milik satu
> perusahaan jasa (disingkat **SKP**) untuk **inventaris alat kesehatan** dan **IPM = Inspeksi dan
> Pemeliharaan Preventif** (di laporan tertulis *"Insfection Preventive Maintenance"*) di banyak
> **faskes** klien. Dibangun dengan PHP **CodeIgniter 4.3.8**, `myth/auth` (login & grup),
> `firebase/php-jwt` (API mobile), Dompdf (PDF), Spout/PhpSpreadsheet (Excel), DataTables. Ada
> **4 grup**: `admin` (admin SKP), `user` (teknisi SKP), `client` (akun faskes, hanya baca), dan
> `teknisi_client` (teknisi faskes). Teknisi mendaftarkan alat dengan **nomor QR `SKP` + 6 digit**,
> foto depan dan foto nomor seri, lalu mengisi formulir IPM (kondisi lingkungan, kelistrikan, alat
> kerja, keamanan, fisik, keamanan listrik, kelengkapan, fungsi, kinerja, pemeliharaan, konsumabel,
> hasil, rekomendasi, catatan) yang dicetak menjadi **laporan IPM (PDF)**. Tanggal kalibrasi dan
> **PDF sertifikat kalibrasi** dari lab eksternal diunggah per alat. Ada ekspor PDF/Excel, dashboard,
> halaman publik per QR, dan API JWT untuk aplikasi Android (React Native).
>
> **Temuan keamanan serius** (lokasi & jenis saja, tanpa nilai): rahasia di `.env`, mode
> `development` di produksi, `phpinfo()` publik, **registrasi mandiri terbuka** sehingga akun tanpa
> grup bisa mengunduh inventaris faskes mana pun, laporan IPM dan PDF bisa diakses **tanpa login**
> lewat nomor QR berurutan, unggah foto tanpa validasi, CSRF mati, token JWT memuat hash kata sandi.
> Perbedaan arsitektur utama dengan Callibrator: upstream = **satu penyedia jasa melayani banyak
> faskes**; Callibrator = **satu tenant per faskes** dan setiap pengguna hanya punya satu tenant.
> Ini keputusan pertama yang dibutuhkan dari pemilik (lihat § 10 dan § Phases).

**Status:** research, 2026-10-07, code-research agent. Source: `mozivid/skpipm.id/apps-ipm/`
(gitignored, read-only; the owner's fork) and `mozivid/skpipm.id/info.php`. Runtime behaviour was
confirmed on a **throwaway local copy** (PHP 8.1 + MariaDB 10.5 on a private Docker network,
`127.0.0.1` only, latest dump restored, throwaway accounts created in that copy only; everything
removed by name afterwards). Record:
[`../../MEMORY/records/2026-10-07-upstream-code-research.md`](../../MEMORY/records/2026-10-07-upstream-code-research.md).
**No real data value, credential, key or person/facility name appears in this document.**

Companion documents:

| Doc | Owner | Content |
|---|---|---|
| `00-OVERVIEW.md` (this) | code research | what the app is, architecture, security, phases |
| [`01-MODULES.md`](./01-MODULES.md) | code research | 15 functional modules and their mapping to Callibrator |
| [`02-FEATURES.md`](./02-FEATURES.md) | code research | 81 user-visible features, status and implementation notes |
| [`03-DATABASE.md`](./03-DATABASE.md) | DB research | schema, counts, data quality, files |
| [`04-SCHEMA-MAPPING.md`](./04-SCHEMA-MAPPING.md), [`05-DATA-MIGRATION.md`](./05-DATA-MIGRATION.md) | DB research | target schema in our conventions; ETL plan |

The merged phase plan is [`TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md`](../../TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md); the draft below is kept for provenance.

---

## 1. What the Application Is

| | |
|---|---|
| Name in UI | Login page: "*Aplikasi Inventory Alat Kesehatan*" under the provider's company name; report header "**IPM** — *Insfection* [sic] *Preventive Maintenance*" |
| **IPM** | **Inspection & Preventive Maintenance** (*Inspeksi dan Pemeliharaan Preventif*) — one on-site visit by a technician to one device, recorded as a structured checklist and printed as a one-page report with signature lines for the technician and the hospital's **IPSRS** (*Instalasi Pemeliharaan Sarana Rumah Sakit*, the facility maintenance unit) |
| Operator | **One service company ("SKP")** whose name, address and logo are hard-coded in the views (`templates/topbar.php`, `auth/login.php`, `ipm/pdf_ipm.php`, `FaskesController::readQr`) — the app is single-provider, not a product |
| Customers | **Faskes** (*fasilitas kesehatan*: hospitals, clinics, community health centres, district health offices) — `mst_faskes`, called "Client" in the UI |
| Assets | **Alat kesehatan** (medical devices) — `trx_inventory`, identified by a **QR number** `SKP` + 6 digits printed on a sticker |
| Users | SKP admins, **SKP technicians (teknisi)**, client (faskes) read-only accounts, faskes technicians |
| Lifecycle | 2023-06 (first migrations) → 2025-01 (last migration, `trx_kalibrasi`) → code edits into 2026 (Indonesian `FIX`/`REVISI` comments) → **live**: the 2026-10-06 dump has IPM rows from that week |
| Scale (2026-10-06) | 118 facilities, 23,722 devices, ~8,190 IPM sessions over ~4,500 devices, 3,640 calibration dates, 11,851 certificate PDFs, 106 users; 116 GB of uploads (see 03 § 2, § 6) |

A field observation from the local run: some clients are **district health offices** whose devices
sit in many community health centres, and the centre's name is typed into the device's **room**
field. The upstream has no facility hierarchy; the room field carries it. This matters for the
tenant mapping (§ 10) and for the ETL.

## 2. Tech Stack

| Layer | Upstream | Notes |
|---|---|---|
| Language/runtime | PHP `^7.4 \|\| ^8.0` | runs on PHP 8.1 locally |
| Framework | **CodeIgniter 4.3.8** (pinned) | legacy auto-routing **off**; explicit routes in `app/Config/Routes.php` |
| Auth | **`myth/auth` 1.2** (session login, groups, `login`/`role` filters) | its **vendor config file was edited in place** (`vendor/myth/auth/src/Config/Auth.php`: custom login/register views, registration on, activation off) |
| API auth | **`firebase/php-jwt` 6.9**, HS256, custom `App\Filters\AuthFilter` | |
| PDF | **Dompdf 2** (`isRemoteEnabled` on) | A4/A3 landscape |
| Excel | **Box Spout 3.3** vendored in `app/ThirdParty/` (`require_once`), `phpoffice/phpspreadsheet` installed but only imported | |
| Grids | `hermawan/codeigniter4-datatables` (server-side jQuery DataTables) | HTML for action buttons is built in PHP |
| UI | SB Admin 2 (Bootstrap 4), jQuery 3.6, select2, Chart.js 3.9 (CDN), Font Awesome | no build step; JS inline in views |
| DB | MariaDB 10.5, `utf8` (3-byte) | see 03 |
| Files | local disk under `public/uploads/` (served directly by Apache) | 116 GB |
| Mobile | **React Native (Hermes) Android APK**, 80 MB, served publicly from `public/` (built 2023-11-30) | consumes `api_v1` |
| Tests | CI4 starter `tests/` only (no app tests) | |
| Dev deps | faker, vfsstream, phpunit | unused |

## 3. Architecture and Request Flow

```
Browser ──► Apache (public/.htaccess → index.php) ──► CI4 router (Config/Routes.php)
                │                                        │
                │ static: /uploads/*, /img/*, *.apk      ├─ filter "login" / "role:a,b" (myth/auth, session)
                ▼                                        ├─ filter "authFilter" (JWT, api_v1 only)
         public/uploads/{foto_depan,foto_sn,inventory}   ▼
                                                    Controller (fat: query building, HTML for grid
                                                    buttons, file moves, PDF/XLSX streaming)
                                                         │
                                                         ▼
                                                    Model (CI4 Model = table gateway; no relations,
                                                    no validation rules, allowedFields only)
                                                         │
                                                         ▼
                                                    MariaDB skp_ipm (no tenant, few FKs)
```

- **Pattern:** fat controllers, anemic models, views mixing PHP + inline jQuery. Grid endpoints
  return DataTables JSON whose action column is **HTML assembled in PHP**.
- **Two models over one table:** `TrxInventoryModel` (web; `useTimestamps=false`, no `created_at` in
  `allowedFields`) and `InventoryModel` (API/technician list; timestamps on). The web's explicit
  `created_at` is silently dropped — which is why 98 % of devices have no `created_at` (03 Q-15).
- **No service layer, no transactions** except `IpmController::ipmSave/ipmEditSave` (`transStart`).
- **IPM storage pattern:** one IPM session is spread over **16 `trx_*` tables** with no header row;
  a session is identified by `(no_qrcode, DATE(created_at))`. Every read does 16 queries filtered
  by `date(created_at)`. See 03 § 4.6.
- **Configuration:** `.env` (environment, base URL, DB, `JWT_SECRET`), `app/Config/*.php`
  (`forceGlobalSecureRequests=true`, `appTimezone=Asia/Jakarta`, CSP off, CSRF filter not applied).

## 4. Auth, Roles and Groups

| Group (`auth_groups`) | Description | Users (dump) | Sidebar (`templates/index.php` picks by `in_groups`) |
|---|---|---:|---|
| `admin` | Administrator (SKP) | 10 | Dashboard · Groups · Add User · Mapping User · Edit Profile · User List · Client · Mapping User Client · Inventory · Input Kalibrasi · Teknisi |
| `user` | **Teknisi** (SKP field technician) | 35 | Dashboard · Edit Profile · Input Inventory · Input Maintenance · Input Kalibrasi · List Inventory · Teknisi |
| `client` | Client (faskes account, read-only) | 57 | Dashboard · Inventory |
| `teknisi_client` | **Teknisi FASKES** (facility's own technician) | 3 | Dashboard · Input Inventory · Inventory · Input Maintenance |

- **Login:** `myth/auth` `AuthController` (username **or** email + password), custom view
  `app/Views/auth/login.php`. Password hash: bcrypt over base64(SHA-384(password)) (myth's scheme).
  Minimum length 6. "Remember me" box shown, but remembering is disabled in config.
- **Registration:** `/register` is **open** (myth `allowRegistration=true`, `requireActivation=null`);
  a registered user gets **no group** (`defaultUserGroup` unset). See S-04.
- **Forgot/reset password:** myth email resetter routes exist; the email transport is not configured
  in `app/Config/Email.php` (not verifiable without sending mail).
- **Facility scoping:** a client/teknisi_client user is linked to exactly one facility by
  `trx_mapping_user_client`; controllers look it up with `where('id_user', user_id())` and add
  `where('id_client', …)` **only in some places** (§ 9 S-05). SKP admins and technicians see every
  facility.
- **Permissions tables** (`auth_permissions`, `auth_groups_permissions`, `auth_users_permissions`)
  are **empty** — authorisation is by group name only, written into each route.
- **Permission denial** throws `PermissionException` → **HTTP 500** with a stack trace (dev mode).

## 5. Routes Map

All routes are in `app/Config/Routes.php` (plus `myth/auth`'s own). Filter column: `login` =
authenticated; `role:x,y` = member of any listed group (the string `login` inside a `role:` list
is treated as a group name that does not exist, i.e. ignored); **— = no filter (public)**.

| Area | Method + path | Controller::method | Filter |
|---|---|---|---|
| Auth | GET/POST `login`, GET `logout`, GET/POST `register`, `forgot`, `reset-password`, `activate-account` | myth `AuthController` | — |
| Home | GET `/` | `User::index` → redirect `dashboard` | login |
| Dashboard | GET `dashboard`; GET `details/(:alphanum)` | `DashboardController::index/details` | login |
| Admin | GET `admin`, `admin/(:num)`; GET/POST `admin/reset-password/(:num)` | `AdminController::index/detail/resetPasswordForm/adminResetPassword` | role:admin |
| Groups | GET `group` | `Group::index` | **login** |
| | POST `groupSave` / `groupEdit` | `AdminController::groupSave` / `Group::groupSave` | role:admin |
| Users | GET `userRegister`; POST `mappingUserSave`; GET `mappingUser` | `AdminController` | role:admin |
| Client mapping | GET `mappingUserClient`; POST `mappingUserClientSave`/`Edit` | `AdminController` | role:admin |
| Facilities | GET `faskes`; POST `faskesSave`; POST `accountEdit` | `FaskesController::index/save/accountEdit` | role:admin |
| Profile | GET `edit_profile`; POST `edit_profile_save` | `AdminController::editProfile/editProfileSave` | login |
| Public QR | GET `readQr/(:alphanum)`; GET `ipm/getIPM/(:hash)/(:hash)` | `FaskesController::readQr/getIPM` | **—** |
| Inventory (client) | GET `inventory`; GET `inventory_list/(:alphanum)` | `InventoryController::index/list` | role:client,teknisi_client |
| Inventory (SKP) | GET `inventorySKP`, `inventory_listSKP`; POST `inventory_update` | `InventoryController` | role:admin,user |
| Inventory input | GET `input_inventory`; POST `inventorySave` | `InventoryController::inputInventory/inventorySave` | role:user |
| | GET `input_inventory_client`; POST `inventorySaveClient` | `…Client` | role:user,teknisi_client |
| Lookups (AJAX) | GET `getAlkes`, `getAlkesEdit`, `getClient`, `getQrcode` | `InventoryController`, `IpmController` | role lists |
| Documents | POST `inventory_upload`; GET `inventory_detail/(:alphanum)`, `inventory_detail_client/…`; DELETE `inventory_delete/…` | `InventoryController` | role:admin (upload/delete); admin,user,client (list) |
| IPM | GET `input_maintenance`; POST `getDataInventory`; POST `ipmSave` | `IpmController` | role:user,teknisi_client |
| | GET `ipm/editIPM`; POST `getDataInventoryEditIPM`; POST `ipmEditSave` | `IpmController` | login / role:user,teknisi_client |
| | GET `inventory_datatable_ipm/(:segment)`, `inventory_ipm`, `ipm/htmlToPDF` | `InventoryController` | **login** |
| | GET `ipm/downloadSertifikatIPM` | `InventoryController::downloadSertifikatIPM` | **—** |
| Calibration | GET `input_kalibrasi`; POST `kalibrasiSave`; GET `kalibrasi_listSKP` | `IpmController` | role:admin,user |
| Exports | GET `inventory_download` (client PDF), `inventory_download_admin` (PDF), `…_admin_xls`, `…_admin_xls_off` | `InventoryController` | **login** |
| | GET `kalibrasi_download_admin_xls`, `…_harian_xls`, `…_by_tgl_kalibrasi_xls` | `IpmController` | role:admin(,user) |
| | GET `kalibrasi_download_rentang_input_xls`, `…_rentang_kalibrasi_xls` | `InventoryController` | role:admin |
| Technicians | GET `teknisi`, `teknisi_list` | `TeknisiController` | **login** |
| Debug | GET `recall` | `IpmController::recall` (dumps every device with Kint `d()`/`dd()`) | role:admin,user,teknisi_client |
| Mobile API | `api_v1/loginUser` (POST), `profile`, `client`, `alat_kesehatan`, `insert_inventory` (POST), `upload_foto` (POST), `data_ipm`, `insert_ipm` (POST), `getInventory/(:num)` | **`Apiuser_1::…` — a class that does not exist in the source** (the file defines `Apiuser`) | `authFilter` (JWT) except login |

## 6. API (`api_v1`, JWT) and the Mobile App

- **Consumer:** the React Native Android app in `public/skpipm-202311302330.apk` (assets show a
  Hermes `index.android.bundle`; not decompiled further).
- **Login** (`Apiuser::login`): validates email + password through `myth/auth`, then issues an HS256
  token with `exp = iat + 600 s`, `nbf = iat + 10 s` (the token is unusable for its first 10 s) and
  the **whole user entity in the `data` claim**. Errors are returned with HTTP **201** and a
  `status: 500` body.
- **Read endpoints:** all facilities, all device types, the full checklist catalogue per device
  type (`data_ipm`: tools, function checks, completeness, performance, electrical safety), and any
  facility's devices by id (`getInventory/{id}`).
- **Write endpoints:** `insert_inventory` (array of devices, `id_user`/`id_client` **taken from the
  body**), `upload_foto` (front + serial photos, random names, recorded in `mst_foto*_inventory`,
  returns URLs), `insert_ipm` (array of facilities → devices → 16 checklist sections, again with
  `id_user`/`id_client` from the body; no transaction, no month-replace logic).
- **Status in this snapshot:** every route targets `Apiuser_1`, which is not in the code. Either the
  live server has an extra file not in the fork, or the API is dead. 368 devices carry `created_at`
  values from Jan–Feb 2024 written through the API-side model — the API **was** used then.
- **Offline-first intent:** batch arrays and a downloadable catalogue suggest the app captured
  offline and synced. This is the one capability with no web equivalent upstream.

## 7. Reports and Exports

| Output | Trigger | Engine | Content |
|---|---|---|---|
| **IPM report** (HTML preview / PDF download) | IPM history row → "Sertifikat IPM" / "Download"; public `ipm/getIPM` | view `ipm/pdf_ipm.php`; Dompdf A4 landscape | header (IPM title, device name, provider logo), facility, room, inventory/QR no., brand, model, S/N, IPM date, calibration date, "Visit ke: 00n"; 14 checklist sections; overall result; maintenance result; recommendation; notes; signature lines **Teknisi Pelaksana** (name filled) and **IPSRS** (blank, wet signature). Print button hidden when rendering PDF |
| **Inventory list PDF** (SKP) | Inventory → "Pdf" | `ipm/pdf_admin.php`, A3 landscape | facility, device, brand, type, QR, S/N, room, floor, condition, technician, work date, **photo thumbnails** (GD resize to 80 px, JPEG q35, cached 30 days as data URI; `tanpa_foto=1` skips photos); signature blocks "Pelaksana Teknis" / "Pihak Rumah Sakit". **Exhausts 512 MB for a large facility** (observed locally) |
| Inventory list PDF (client) | client Inventory → "Download" | `ipm/pdf.php`, A4 landscape | device columns only |
| **Inventory XLSX** | Inventory → "Xls" | Spout | 14 columns incl. latest calibration date, technician, photo URLs |
| **Calibration recap XLSX** ×5 | Input Kalibrasi page: list "Xls"; *Rekap Harian* (by input date), *by Tgl Kalibrasi* (single calibration date), *Rentang Input* (input-date range), *Rentang Kalibrasi* (calibration-date range); optional facility | Spout | facility, device, brand, type, QR, S/N, room, floor, calibration date, entered by |
| Dashboard | — | Chart.js donut | totals by condition |

There is **no** certificate number, no PDF signature, no QR on any upstream document, and no stored
copy of an issued report — every report is re-rendered from the current rows.

## 8. File Uploads

| Upload | Where | Validation | Naming | Stored as |
|---|---|---|---|---|
| Device **front photo** (`foto_depan`), **serial-plate photo** (`foto_sn`) — mandatory on create | web `inventorySave`, `inventorySaveClient`, `inventory_update`; API `upload_foto` | **none** on the web (no type, size or MIME check); none on the API | web keeps the **client's original file name** (`move()` without a name); API uses random names | **absolute URL** in `trx_inventory.foto_*` |
| **Calibration document** (certificate PDF from the external lab) | `inventory_upload` (admin) | `uploaded`, ≤10 MB, `ext_in` jpeg/jpg/png/docx/pdf | random name | bare name in `trx_inventory_file` |
| Profile photo | `edit_profile_save` (admin only) | none | random | `users.user_image` |
| Facility logo | `faskesSave` | **a text field**, not an upload | — | `mst_faskes.img_logo` |

Photos are taken with phone cameras (median 1.9 MB; ~900 HEIC files that browsers cannot render).
Old photos are unlinked on replacement; documents are only un-recorded on delete (file stays).
About 8,200 of the 11,900 certificate PDFs have human-readable names that the app never generates —
they were **copied in by an operator outside the app**, together with a shell script and its file
list for moving files to a `hapus` ("delete") folder (03 § 6).

## 9. Security Findings (location and type only)

Verified items were reproduced on the throwaway local copy; nothing was tested against the live
site. **No secret value was read into, or is reproduced in, any document.**

| # | Severity | Location | Type | Verified locally |
|---|---|---|---|---|
| S-01 | **Critical** | `apps-ipm/.env` | **Secrets in a plain file in the app tree**: DB host/name/user/password and `JWT_SECRET` (the app's `.gitignore` excludes it, but the fork contains it). Treat both as compromised once this copy circulates — **owner should rotate** | file present |
| S-02 | **Critical** | `apps-ipm/.env` `CI_ENVIRONMENT` | **Production runs in `development` mode**: full stack traces with file paths and SQL on every error, Kint dumps enabled | yes (permission denial → 500 with trace) |
| S-03 | **Critical** | `mozivid/skpipm.id/info.php` | **`phpinfo()` exposed** at the site root (PHP config, paths, environment) | file content |
| S-04 | **Critical** | `vendor/myth/auth/src/Config/Auth.php` (edited vendor file) | **Open self-registration without activation**; the new account has no group, yet every `login`-only route admits it: any facility's **full inventory XLSX** (`inventory_download_admin_xls?id_client=`), any IPM report (`ipm/htmlToPDF`), cross-facility dashboard totals, technician activity | yes |
| S-05 | **High** | `InventoryController::list/inventory_listSKP/inventory_download_admin*/inventory_detail*`, `IpmController::kalibrasi_*`, `TeknisiController::list`, `inventorySaveClient`, `ipmSave` | **Broken object-level authorisation**: facility id taken from the URL/query/body instead of the user's mapping; a client account can read (and a facility technician can write into) another facility | by code |
| S-06 | **High** | `Routes.php` `readQr`, `ipm/getIPM`, `ipm/downloadSertifikatIPM` | **Unauthenticated access** to device identity, photos, calibration-document links, IPM history, IPM reports and PDFs (with the technician's name) by **sequential, guessable** QR numbers + a date | yes |
| S-07 | High | `FaskesController::readQr` (raw `echo`), `ipm/pdf_ipm.php` and other views (`<?= ?>` without `esc`), `TeknisiController::list` action HTML | **Stored XSS** from device fields, notes and file names (some grids were fixed with `esc()`, others not) | by code |
| S-08 | High | `InventoryController::inventorySave/inventorySaveClient/inventory_update`, `Apiuser::upload_foto` | **Unrestricted file upload** into a web-served folder, original names kept, no extension/MIME/size check, no `php_flag engine off` in `uploads/` — potential remote code execution; SVG → XSS. (No `.php` file was found on disk — checked by name only) | by code |
| S-09 | High | `app/Config/Filters.php` `$globals` | **CSRF protection disabled** for all forms (password reset, user/group mapping, device update) | by config |
| S-10 | High | `Apiuser::login` | **JWT carries the full user row** (password hash, reset/activation hashes) in a readable payload | by code |
| S-11 | High | `Apiuser::inventory/trx_ipm/getInventory` | API trusts `id_user`/`id_client` from the body; any token holder can attribute work to anyone and read any facility | by code |
| S-12 | Medium | `IpmController::recall`, route `recall` | **Debug endpoint** dumps every device row | by code |
| S-13 | Medium | `public/*.apk`, `public/uploads/inventory/*.txt`, `*.sh` | Operator and build artefacts served publicly | yes (HTTP 200) |
| S-14 | Medium | `App\Filters\AuthFilter` | catches `Exception` without importing it → an invalid token raises an uncaught error (500) instead of 401; JWT secret read with `getenv` per request | by code |
| S-15 | Medium | `InventoryController::inventory_download_admin_xls_off` | Dompdf with `isRemoteEnabled` and **TLS verification off**; content built from stored, unescaped values → SSRF/remote-fetch vector (route is login-only) | by code |
| S-16 | Medium | whole app | **No audit trail**; IPM edit = delete + re-insert (history destroyed); hard deletes everywhere — incompatible with ISO 17025 / 21 CFR Part 11 record integrity | by code |
| S-17 | Low | myth config | min password length 6, no MFA, no lockout policy beyond myth defaults; login attempts with IP in `auth_logins` (personal data) | by config |
| S-18 | Low | `app/Config/App.php` | CSP disabled; jQuery/Chart.js from CDN | by config |

Privacy: the database and uploads hold personal data (names, emails, password hashes, login IPs,
technician names on reports) and facility-identifying data; device photos may incidentally capture
people or patient areas. See 03 § 9 and Phase UP-05 below.

## 10. Architecture Gap That Drives Everything: Provider vs Facility Tenancy

| | Upstream | Callibrator (as built) |
|---|---|---|
| Who owns the data | one service provider; facilities are rows (`mst_faskes`) | **one tenant per facility**; deny-by-default Sequelize hooks (`docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`) |
| Provider staff | see and write every facility | a user has **one** `tenantId` (`backend/src/models/user.model.ts`); no membership table, no tenant switch |
| Hierarchy | none (district office → centres typed into "room") | `tenants.parent_id` + `tenant_hierarchies`, but **a parent never sees a child's data** (ADR-084) |
| Roles | admin / teknisi / client / teknisi_client | `CALIBRATOR ADMIN`, `TECHNICIAN`, `HEALTHCARE ADMIN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE` (IPSRS), `ROOM USER` … (`backend/src/constants/roleConstants.ts`) — roles already exist for both sides |

Three ways to land the upstream, each needing an **ADR and the owner's decision** (Q-57 follow-up):

1. **Facility = tenant, provider staff get multi-tenant membership** (new `user_tenant_memberships`
   + an explicit "act in tenant X" context; every request still runs inside exactly one tenant, so
   the hooks are unchanged). Best fit for our isolation model and for facilities that already use
   Callibrator directly. Cost: auth/session/context work, audit of "who acted for whom", UI tenant
   switcher. **Recommended.**
2. **Provider = tenant, facilities = a tenant-scoped `client_facility` entity**, client users
   restricted to one facility by a second row-level scope. Mirrors upstream exactly, but adds a
   second isolation dimension the hooks do not know — the A-87 class of bug, again.
3. **Super-admin-style cross-tenant operator role** for the provider. Rejected in advance: it
   widens the most dangerous role in the system.

The DB agent's 03 § 5 reaches the same shape ("calibration-provider tenant serving hospital
tenants"); its 04 § 3 carries the schema side.

## 11. Code Quality and Drift Notes

These are evidence for the ETL and for "do not copy" decisions, not criticism.

| # | Finding | Where | Consequence |
|---|---|---|---|
| D-01 | Two models for `trx_inventory`; the web one drops `created_at` | `TrxInventoryModel` vs `InventoryModel` | 23,354 devices with NULL `created_at` |
| D-02 | Radio value "Tidak Ada" stored into `aksesoris varchar(5)` | `inventory/input_inventory.php`, schema | stored as **"Tidak"** (271 rows) — map "Tidak" → "absent" |
| D-03 | Dashboard counts "Rusak" as `kondisi_alat != 'Baik'` | `DashboardController::index/details` | the **135 "Laik"** (= fit for use) devices are counted as broken |
| D-04 | Recommendation codes: catalogue notes say `1,-1,2,3`; the form and the report use `1,0,-1,-2` | `Seeds/MasterIPM.php` vs `ipm/input_maintenance.php`, `ipm/pdf_ipm.php` | data follows the form (no 2/3 found); the catalogue text is stale — map from the form's codes |
| D-05 | Performance tests have a master catalogue + per-type mapping, used only by the API; the web form takes free text | `MappingKinerjaAlatModel`, `IpmController::getDataInventory` | item id NULL on all 13,470 rows (03 Q-7) |
| D-06 | Battery section: UI commented out, model lacks `nilai_acuan`, edit does not delete battery rows | `input_maintenance.php`, `TrxBatteryModel`, `ipmEditSave` | when an edit moves the IPM date, its battery rows stay on the old date |
| D-07 | `ipmSave` "update" deletes **every row of the current month** for the QR, across 16 tables | `IpmController::ipmSave` | at most one IPM per device per calendar month by design; re-submission destroys the earlier one |
| D-08 | Visit number: `getDataInventory` returns a 0/1 flag, the form adds 1 | `IpmController` | "Visit ke" is not a reliable visit count (max 3 in data) |
| D-09 | `trx_kalibrasi` is an upsert per device ("latest technician wins") yet reports aggregate `MAX(tanggal_kalibrasi)` | `kalibrasiSave`, exports | history is lost on each entry; 110 devices still have two rows from before the upsert |
| D-10 | Mapping models declare `allowedFields` as one comma string | `Mapping*Model.php` | catalogues can only be written by seeders/SQL — there is no catalogue UI |
| D-11 | Duplicate implementations | `kalibrasi_download_rentang_*` in both controllers (routed copy INNER JOIN, dead copy LEFT JOIN); `FaskesController::getIPM` ≈ `InventoryController::getDataIPM` ≈ `inventory_ipm` | divergence risk; port one behaviour |
| D-12 | Dead/residual code | `IpmController::index` (joins a non-existent table), `inventory_download_admin_xls_off` (hard-coded filter), `Views/InventoryController.php`, `ipm/pdf_ipm copy.php`, `views_ipm.rar`, `masterData/group.php` + `admin/roleGroup.php` (UI residue of another product: "Budget Company", "Promo Card", undefined `/permisionMenu`) | do not port |
| D-13 | QR normalisation `"SKP".sprintf('%06d', (int) …)` | `inventorySave*` | anything non-numeric becomes `SKP000000`; 4 rows break the pattern |

## Phases (draft for the coordinator)

Draft phase list for `PHASE-UPSTREAM-PHP-ADOPTION.md`. Research phases are done as of 2026-10-07;
every later phase follows the repository's Definition of Done (`TASKS/00-TASK-CONVENTIONS.md`).
IDs are provisional (`UP-nn`); the coordinator merges this with the DB agent's ETL plan.

| # | Phase | Goal | Output / exit | Depends on |
|---|---|---|---|---|
| UP-00 | **Decisions & ADRs** | Settle what blocks design: tenancy model (§ 10), scope (which features), mobile app, public QR page, IPM-as-record semantics, data that may legally move | ADRs in `MEMORY/DECISIONS.md`; Open Questions in `TASKS/BACKLOG.md` answered or delegated | — |
| UP-01 | Code research | Understand the upstream code | **Done** — 00/01/02 | — |
| UP-02 | DB-structure research | Understand schema, data, files | **Done** — 03 (DB agent) | — |
| UP-03 | Module research | Group code into modules, map to ours | **Done** — 01 | UP-01 |
| UP-04 | Feature research | Fine-grained feature gap list | **Done** — 02 | UP-03 |
| UP-05 | **Security, privacy & data protection** | DPIA under Indonesia's PDP Law (UU 27/2022) and our GDPR posture; legal basis/contract with the provider and facilities for moving their data; credential rotation advice for the upstream (S-01..S-04) **before** any copy leaves the owner's machine again; photo/EXIF policy; retention of login IPs | DPIA record; decision on what is migrated vs archived; upstream hardening advice handed to the owner | UP-00 |
| UP-06 | **Role & permission mapping** | Map 4 groups → our roles and menu slugs; define facility-side vs provider-side gates; two-tenant test plan | role matrix in 01; `seededMenuSlugs` additions | UP-00 |
| UP-07 | **Domain design** | IPM session aggregate + versioned checklist templates; QR asset tag; device condition vocabulary; IPM report as an issued, immutable document; calibration-date vs calibration-record semantics (03 Q-11) | specs in `MEMORY/specs/`; doc amendments via the deviation protocol | UP-00, UP-06 |
| UP-08 | **DB-structure migration to our conventions** | Sequelize models + forward migrations (UUID PKs, `tenant_id`, snake_case, `is_deleted`, audit, JSONB shapes) for catalogue, templates, IPM, device extensions | migrations proved on an upgrade boot; models with `initModel` | UP-07, DB agent 04 |
| UP-09 | **Backend implementation** | Services, routes, Zod contracts, OpenAPI, permission gates, audit rows, two-tenant tests, report/PDF/XLSX | `make verify` green; live E2E for new routes | UP-08 |
| UP-10 | **Frontend implementation** | Pages for catalogue admin, device registration with photos, IPM capture (mobile-first), IPM history/report, exports, client dashboard, public QR page | jest + browser a11y + responsive suites | UP-09 |
| UP-11 | **Report & PDF template parity** | IPM report, inventory PDF, 5 calibration recaps — field-for-field parity (with our certificate numbering, QR verification and signatures added) | golden-file tests; side-by-side sign-off by the provider | UP-09 |
| UP-12 | **Data migration / ETL** | Extract → transform (03 Q-1..Q-28) → load per tenant; 116 GB files into our storage (HEIC → JPEG, dedupe, strip host from URLs); idempotent re-runs | rehearsal on a disposable stack; counts reconciled | UP-08, UP-05, DB agent 05 |
| UP-13 | **Reconciliation & parity verification** | Prove the migrated data equals the source: per-facility device counts, IPM sessions per device, documents per device, sampled report diff | reconciliation report; zero unexplained deltas | UP-12 |
| UP-14 | **UAT with real users** | Provider technicians in the field (phones, poor connectivity), facility admins, IPSRS | UAT sign-off; defects triaged | UP-10, UP-13 |
| UP-15 | **QR sticker continuity** | Thousands of physical stickers already exist; find out what they encode (number only, or a `…/readQr/SKPnnnnnn` URL) and keep them resolvable: redirect from the old host to our public device page | redirect map; sticker-scan test | UP-07, UP-10 |
| UP-16 | **Mobile / offline capture** | Decide: retire the APK in favour of a responsive web capture (PWA, offline queue) or keep a native app on our API | ADR; if kept, API contract + device auth | UP-00 |
| UP-17 | **Training & documentation** | Indonesian user guides for technicians, facility admins; changed concepts (one IPM can no longer be overwritten; corrections instead) | guides; short videos | UP-14 |
| UP-18 | **Cutover & dual-run** | Freeze window, final delta ETL, read-only upstream, DNS/redirects, rollback plan; dual-run period where upstream is read-only reference | cutover runbook in `TASKS/`; go/no-go record | UP-13, UP-14, UP-15 |
| UP-19 | **Decommission & archive** | Encrypted archive of the upstream DB + files for the retention period, secure deletion of copies (including `mozivid/` on workstations), credential revocation | decommission record | UP-18 |

Suggested build order inside UP-09/UP-10 (thin vertical slices): catalogue & templates → device
extensions (QR, photos, condition) → IPM capture → IPM report → calibration-date entry & recaps →
inventory exports → dashboard condition widgets → public QR page → provider multi-tenant access.
