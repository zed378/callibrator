# Changelog

User-visible and operationally significant changes, newest first. Coarser than [`MEMORY-INDEX.md`](./MEMORY-INDEX.md); every entry links to a record or an ADR.

Format loosely follows Keep a Changelog. Dates are absolute.

---

## Unreleased

### 2026-10-10 — The device register page: QR, type, condition, room and the two required photos (P22-02) ([record](./records/2026-10-10-p22-02-device-register-ui.md))
- **Changed:** `dashboard/devices` is rebuilt, in Indonesian and English. The list filters by QR sticker, type, condition, status, calibration due and (provider staff) facility, and shows each device's front-photo thumbnail, room and floor, condition and next calibration. The form registers or edits a device with its QR sticker, type (searched), room (typed; found or created in the device's facility), condition, accessories, inventory date, laboratory and IPM interval; a facility-bound technician sees only the fields their account may set.
- **Added:** after registering a device, its front and serial-plate photos are asked for (camera on a phone) before "Finish"; photos can be replaced or deleted later. Every photo is shrunk and converted to JPEG in the browser before upload, which also removes its location data. A HEIC photo the browser cannot convert is explained (set the camera to JPEG).

### 2026-10-10 — A flaky SSO timing test made deterministic (A-292) ([record](./records/2026-10-10-a292-sso-timing-flake.md))
- **Fixed (tests only):** the proof that an unknown tenant code and a tenant without SSO refuse in the same time no longer depends on the CI machine's load; it now checks both answer at exactly the floor on a fake clock. No behaviour change.

### 2026-10-09 — The home page's device-condition and IPM figures, for facility users too; "due" for a chosen month; search by QR; the IPM checklist menu entry (P21-07; ADR-126 Am. 6) ([record](./records/2026-10-09-p21-07-dashboard-ipm-due.md))
- **Added:** `GET /api/v1/dashboard/metrics` returns the devices per condition (`good`, `not_good`, `broken`, `unset`) and the IPM figures (visits of the last 30 days; scheduled, due this month and never-inspected devices, in a tenant view). A facility-bound account can now open the home page and gets its own facility's figures only (cached per facility).
- **Added:** `GET /api/v1/ipm/due?month=YYYY-MM` lists what is due by the end of a month from the current one up to 24 months ahead; other months answer 400 `IPM_DUE_MONTH_OUT_OF_RANGE`. The quick search finds a device by its QR code, in any case, ranked first. The operator's proposal queue shows each tenant's name.
- **Changed:** the **IPM Checklists** entry (`/dashboard/ipm-templates`) is now in the sidebar (migration 0130; a running deployment shows it after the menu cache expires).

### 2026-10-09 — The calibration-date page: an outside lab's date by QR sticker, and the calibration list (P22-05) ([record](./records/2026-10-09-p22-05-calibration-dates-ui.md))
- **Added:** `dashboard/calibration-dates`, in Indonesian and English, linked from the calibration page. A technician with `calibration` write types or scans a device's QR sticker, sees the device, its last calibration and its room, and records an outside laboratory's calibration date (laboratory, certificate number, stated next date, verdict, room confirmed or changed). No file is stored; a same-day entry is warned about and kept; the new next date is shown. Every `calibration` reader gets the calibration list: latest per device by default, filtered by sticker, kind, a date range on the calibration or input date, and (provider staff only) the facility. Facility-bound accounts and the platform operator read the list but do not record.
- **Not yet in the sidebar:** the page has no menu entry of its own (a backend seed, if wanted); it is reached from `/dashboard/calibration`.

### 2026-10-09 — The IPM checklist catalogue page (P22-01) ([record](./records/2026-10-09-p22-01-catalogue-admin-ui.md))
- **Added:** `dashboard/ipm-templates`, in Indonesian and English. The platform operator maintains the global catalogue there — checklists and their drafts (add from the library, order, required, save at a revision, publish with a change note; publishing the base republishes every type checklist), the item library (with a live preview of how a limit is read), the device types, and the tenants' proposal queue (accept / reject). Everyone with a catalogue read sees the published checklists read-only; tenant users with `ipm-templates` propose changes and withdraw them. A facility-bound account sees no proposals.
- **Not yet visible in the menu:** the `ipm-templates` entry stays inactive until the backend turns it on (seed + migration, ADR-124 Am. 5).

### 2026-10-09 — Calibration recaps and the inventory export: paged reads for the browser (P21-06; ADR-133 Am. 3) ([record](./records/2026-10-09-p21-06-export-reads.md))
- **Added:** `GET /api/v1/calibration-records` takes `dateField` (`calibration` | `created`), `fromDay` / `toDay` (inclusive days of the tenant's time zone), `latestOnly` (one row per device), `entryKind`, `clientFacilityId`, `qrCode`, `sort`; `limit` up to 200. Rows add the device's QR, the room as confirmed at entry ("—" when none), `effective`, and the facility for provider staff.
- **Fixed:** a facility-bound user filtering a device or calibration list by ANOTHER facility got their own facility's rows back; they now get an empty list. No other facility's data was ever returned.

### 2026-10-09 — Device photos: upload, replace and delete, with metadata-free thumbnails (P21-02b; ADR-132 Am. 3) ([record](./records/2026-10-09-p21-02b-device-photos.md))
- **Added:** `POST /api/v1/calibration-devices/:id/photos` (front, serial plate, other; a new front or serial-plate photo replaces the old one) and `DELETE …/photos/:attachmentId`; reachable by facility-bound technicians for their facility's devices. Each photo gets a display (1,600 px) and a thumbnail (320 px) copy without any metadata; `POST /attachments/:id/signed-url` takes `variant: "display" | "thumb"`.
- **Changed:** photos are checked by their content; **HEIC/HEIF photos are refused (415 `PHOTO_HEIC_UNSUPPORTED`) and must be converted to JPEG by the app or browser**. Location (GPS) metadata is removed from the stored original.
- **Dependencies:** `jpeg-js` 0.4.4, `pngjs` 7.0.0 (pure JavaScript; no native module in the image).

### 2026-10-09 — Calibration dates: an outside lab's date by QR, and the next due date that no longer moves backward (P21-05; ADR-133 Am. 2) ([record](./records/2026-10-09-p21-05-calibration-dates.md))
- **Added:** `POST /api/v1/calibration-devices/:calibrationDeviceId/calibration-dates` — an outside laboratory's calibration by its date and key data (laboratory, certificate number, stated next date, verdict), **no file**; a same-day entry is kept with a notice; API keys allowed; not reachable by facility-bound accounts.
- **Changed (every tenant — a defect fix, BACKLOG G-11):** a device's next calibration date is now derived from its **latest effective record** on create, correction and void. An older certificate typed in today no longer moves the date backward; voiding or correcting the record that set it moves it back to the previous record (or clears it). A date typed on the device form is `manual` and stays until the next record. Existing dates change at the first record written after the release.
- **Added:** `calibrationDue` and `lastCalibration` on device reads; `GET /calibration-devices?calibrationDue=overdue|due_soon|requested`; the tenant setting `calibration_due_soon_days`. The calibration scan now schedules a device an IPM visit flagged for calibration.

### 2026-10-09 — The device register's API: QR codes, rooms, the lookup by sticker, the field working set (P21-02a; ADR-132 Am. 2) ([record](./records/2026-10-09-p21-02a-device-register-api.md))
- **Added:** device QR codes, normalised with the tenant's prefix and digits (`device_qr_code_prefix`, `device_qr_code_digits`), unique per tenant (a taken sticker is a 409 naming its device); `GET /api/v1/calibration-devices/by-qr/:qrCode`; condition, inventory date, accessories, calibration laboratory, IPM interval and the registrant on the device; rooms found or created by name and floor on the device form; offline `clientRef` and `Idempotency-Key` on create.
- **Added:** device reads carry `ipmDue`, `lastIpm`, the caller's open IPM draft, `photosComplete`; list filters `qrCode`, `deviceTypeId`, `condition`, `locationId`, `clientFacilityId`, `sort=id`, `view=field` (the PWA working set, capped by `field_working_set_max_devices`); a page holds up to 200 devices.
- **Changed:** facility users see their facility's rooms in `GET /warehouses` (A-9); the warehouse and stock screens list stores only; stock cannot be put in a room; a device's facility cannot be changed by an edit (move it).
- **Not yet:** device photos (P21-02b).

### 2026-10-09 — IPMs can be submitted: the report is issued, signed, verified publicly; corrections and voids complete; "due" (P21-04; ADR-126 Am. 5) ([record](./records/2026-10-09-p21-04-ipm-submit-report-signatures.md))
- **Added:** `POST /api/v1/ipm/sessions/:sessionId/submit` — issues the report (number `IPM-<facility>-<YYYYMMDD>-<NNN>`, verification token, `ipm-report-v1` content hash, issuer snapshot), numbers the visit, writes the visit's Preventative work order and the recommendation's side effects (UD-17, a **working decision**: Repair order, device to `maintenance`, calibration request — switchable per tenant by `ipm_recommendation_side_effects`); a correction's submit supersedes the original.
- **Added:** `POST …/void` (unbound tenant administrator), `GET …/report-document` (the data the browser renders; `?render=` audited), `POST …/signatures` (the performer's signature and the IPSRS countersignature, behind `ipm_countersign_enabled`), the public `GET /api/v1/ipm/verify/:reportNumber?token=`, and `GET /api/v1/ipm/due`.
- **Added:** tenant settings `tenant_time_zone`, `ipm_interval_months`, `ipm_countersign_enabled`, `ipm_recommendation_side_effects` (validated when saved).
- **Changed:** the issuer snapshot's shape gains `timeZone`; the e-signature sidebar leaf for bound users moves to P23-02 (G-P2).

### 2026-10-09 — IPM drafts and corrections get their API; offline replays are idempotent; IPM photos; scope-loss codes (P21-03; ADR-126 Am. 4) ([record](./records/2026-10-09-p21-03-ipm-session-api.md))
- **Added:** `/api/v1/ipm/sessions` — list, one session, create a draft (pinned checklist, `clientRef`), edit the header, replace the results (checked against the pinned version), discard, start a correction; `GET /api/v1/calibration-devices/:id/ipm-sessions`. Every 409 carries a top-level `code` (`IPM_CONFLICT_CODES`). **Not yet:** submit, void, "due" (P21-04).
- **Added:** `Idempotency-Key` on every IPM draft write and on `POST /attachments` (replay answers the stored status with the resource re-read; a refused request frees its key); a nightly purge (`IDEMPOTENCY_KEY_PURGE_SCHEDULER`, 03:53).
- **Added:** IPM photos (`resourceType: inspectionsession`, the caller's own draft only); `POST /api/v1/field/wipes` (tenant administrators, counts only).
- **Changed:** 403 refusals of an inactive/banned account and of a suspended/deleted tenant carry `code` (`ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED`); a device with an open IPM draft cannot be moved (409).
- **Users notice:** nothing yet — the `ipm` menu stays inactive until P22.

### 2026-10-09 — Device register extensions, calibration-date columns and photo purposes in the database (P20-02, P20-08; ADR-132 Am. 1, ADR-133 Am. 1) ([record](./records/2026-10-09-p20-02-08-device-extensions.md))
- **Added (schema only, no routes yet):** migration 0128 — a device's QR (unique per tenant, deleted devices included), condition, inventory date, lab, registrant, IPM interval and offline reference; rooms (`warehouses.kind = room`, a floor, a facility, a name unique per facility) that hold only their facility's devices; a calibration record's entry kind, lab and snapshots; the next date's source; the IPM calibration request. Migration 0129 — `attachments.purpose` with one live front and serial-plate photo per device; IPM-session photos scoped to the session's facility and carried by a device move.
- **Operational:** every existing warehouse becomes a `store`; every existing next calibration date is labelled `manual`. `0128`/`0129 down` refuse once any new column holds data.

### 2026-10-09 — The IPM session's tables and their immutability in the database (P20-04, P20-05; ADR-126 Am. 3) ([record](./records/2026-10-09-p20-04-05-ipm-schema.md))
- **Added (schema only, no routes yet):** migration 0126 — `inspection_sessions`, `inspection_results`, `inspection_session_signatures`, `idempotency_keys`, tenant- and facility-scoped with composite keys that follow a device move; migration 0127 — after submit a session changes only in its lifecycle, results only while a draft, signatures never, for every database role.
- **Operational:** the boot applies 0126 and 0127; `0126 down` refuses once any IPM row or key exists. Re-running 0117 alone afterwards would break every IPM result insert (42703) — never run a migration outside the manifest order.

### 2026-10-09 — The global inspection catalogue gets its API: device types, checklists, publishing, the offline download, tenant proposals (P21-01; ADR-125 Am. 3) ([record](./records/2026-10-09-p21-01-catalogue-api.md))
- **Added:** `/api/v1/device-types` (read by any `calibration` / `ipm` / `ipm-templates` reader; written by the platform operator); `/api/v1/ipm/templates/published` (every published checklist and the active types, strong `ETag`, 304); `/api/v1/ipm/template-versions/:id`; the operator's item library, templates, drafts, publish (publishing the base checklist re-publishes every type checklist on it) and discard; tenant proposals (`ipm-templates`) and the operator's queue under `/api/v1/admin/ipm/template-proposals`.
- **Changed:** a device may carry `deviceTypeId`; giving it a retired or unknown type is a 400 (a device keeps a type that was retired later).
- **Migration 0125:** the one-open-draft index leaves out a base rebase's version.
- **Users notice:** nothing yet — the `ipm` / `ipm-templates` menus stay inactive until P22.

### 2026-10-08 — Devices move between client facilities with their history; facility accounts get their facility's records and their own self-service; identity providers cannot place an account in a facility (P21-09d, P21-09e; ADR-124 Am. 6) ([P21-09d record](./records/2026-10-08-p21-09d-move-keys-links.md), [P21-09e record](./records/2026-10-08-p21-09e-displays-routes-provisioning.md))
- **Added:** `POST /api/v1/calibration-devices/:id/move` (tenant administrators) and `GET …/moves` — the device's records, certificates, work orders, readings, non-conformances and files follow it; two audit rows; files re-keyed under the new facility afterwards.
- **Added:** records, files, certificates and work orders carry `performerDisplay` / `uploaderDisplay` / `calibratedByDisplay` … / `assigneeDisplay` — a name, role and organisation, never an id or e-mail; a signed certificate shows its printed snapshot.
- **Added:** `POST /users/create` may create an account bound to a client facility (409 while `FACILITY_BINDING_ENABLED` is off); settings `client_facilities_bound_user_deactivation_days` and `client_facilities_ended_retention_years`; a nightly job deactivates an ended facility's bound accounts (`BOUND_ACCOUNT_DEACTIVATION_SCHEDULER`).
- **Changed:** reminders reach the bound users of the device's facility by name (the tenant broadcast is unchanged); dashboard cache keys moved to `v2` (one recomputation); signed download links are `v3` (links minted before the deploy stop working — they lived ≤ 15 min); SSO / SCIM accounts in a tenant with client facilities wait for an administrator (`FACILITY_BINDING_PENDING`); SCIM refuses facility attributes.
- **Users notice:** the new display fields only; no account is bound yet. `FACILITY_BINDING_ENABLED` stays off — the § 11 gate is not green.

### 2026-10-08 — Technicians can register devices and record calibrations; the record void is an administrator's; the IPM and client-facility menus exist; client facilities can be administered through the API (P20-06, P21-09c; ADR-124 Am. 5) ([P20-06 record](./records/2026-10-08-p20-06-ipm-menus-ud4b.md), [P21-09c record](./records/2026-10-08-p21-09c-facility-routes-ceiling.md))
- **Changed for every tenant (UD-4 (b)):** `TECHNICIAN` and `HEALTHCARE TECHNICIAN` hold `calibration` write — device create/edit/delete/bulk import, record and correct calibrations, predictive-maintenance analyse/approve. **Voiding a calibration record now needs a tenant administrator** (403 otherwise). Migration `0124`; flush `permissions:*` after deploying it.
- **Added:** menu slugs `ipm`, `ipm-templates`, `client-facilities` with their grants (entries inactive until their pages ship); API-key scopes for them.
- **Added:** `/api/v1/client-facilities` administration — list, options, read, create, edit, status (leaving active revokes the facility's bound sessions), delete (only an unreferenced facility), bound users. Not available to facility-bound accounts or API-key writes.
- **Added:** the bound menu ceiling — a facility-bound account's permissions are capped (P18-03 Matrix B); `GET /menu-groups/my-permissions` answers `facilityBound`. `FACILITY_BINDING_ENABLED` stays off.

### 2026-10-08 — The facility dimension: bound accounts are confined by the hooks and the route layer; the binding route (P21-09a, P21-09b; ADR-124 Am. 4) ([record](./records/2026-10-08-p21-09-facility-dimension.md))
- **Built:**
  - A second, deny-by-default scope in the global hooks for a facility-bound account: its facility's rows, its own facility/session/notification/consent rows, nothing else; a row's facility changes only through a move or a binding (AM-6), in every context.
  - A bound account whose facility is paused or ended (or still waiting to be bound) is refused with a top-level `code` (`FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_BINDING_PENDING`, `FACILITY_UNRESOLVED`); its sockets join only its facility's room.
  - `POST /auth/verify` returns `clientFacilityId`, `facilityBound`, `facilityMode` and `scopeFingerprint`.
  - A route gate: a bound account reaches only the reviewed self routes; everything else answers 403 `FACILITY_ROUTE_REFUSED` before a parameter is read.
  - `GET /api/v1/client-facilities/mine`; `PUT /api/v1/users/:userId/client-facility` (refused with 409 until `FACILITY_BINDING_ENABLED=true`).
  - A device created without a facility goes to the tenant's own facility; serial numbers are checked per facility; audit rows carry the resource's facility.
- **Users notice:** nothing — no account is bound yet, and a tenant with only its own facility reads `facilityMode: "single"`.
- **Not yet:** the facility administration routes (wait on P20-06's menu slugs), device moves, the bound menu ceiling, domain reads for bound accounts (P21-09c – e).

### 2026-10-08 — The public pages get their own root layout and stylesheet (P10-18, ADR-131 built + Am. 1); three public forms load their API layer on demand (P10-19) ([record](./records/2026-10-08-p10-18-19-public-layout.md))
- **Built:**
  - `app/(public)` and `app/(app)` route groups, each with a root layout rendered through one `app/rootDocument.tsx` (nonce, `lang`, metadata, no providers). **No URL changed** (route table identical).
  - The public pages load `app/public.css` (public tokens + Tailwind for the public sources only) instead of the dashboard's sheet: first-load CSS `/` 28.1 → 16.7 KB gzip, `/login` and the other public pages 23.3 → 12.0 KB.
  - A public-styled 404 (`app/global-not-found.tsx`, `(public)/not-found.tsx`); per-group error boundaries, each one `<main>`/`<h1>`.
  - `/request-access`, `/forgot-password`, `/invitation`: first-load JS 147.8 / 146.8 / 146.4 → 127.6 / 126.7 / 126.3 KB brotli; requests unchanged.
  - `bundle-budget.mjs` reports CSS and enforces `cssGzipKB`; three JS ceilings lowered, none raised.
- **Users notice:** signing in and out is now a full page load (two root layouts); the public pages look identical (pixel comparison: 0.00 %); the 404 is drawn in the public look.
- **Not claimed:** simulated LCP did not move beyond noise (AC-5/AC-6 still not met under Lighthouse simulation; `/` FCP 1.97 → 1.82 s; real-browser `/login` LCP 1.54 → 1.22 s). The live E2E pair was not run.
- **Found:** A-368 (pre-existing): the calibration records table overlaps its cells at 360 px once a record exists.

### 2026-10-08 — The backend-agnostic contract planned (ADR-136); the Go mobile phases restructured; mobile owner answers ([record](./records/2026-10-08-contract-first-and-mobile-restructure.md))
- **Plan (target, not built):** one language-neutral contract in `contracts/` that every backend implements and every client is generated from, so the web and the mobile app never need a version per backend; a black-box conformance suite (a port or module is done only at 100%), run in CI for each backend; ports replace Node module by module behind a gateway on one database (`docs/CONTRACT/`). Phases 32 … 34, after Phase 31.
- **Restructured:** one mobile plan (Phases 35 … 40); only the backend for mobile has a Go variant (Phase 1000). Phase 999 (Go) is now built module by module against the contract.
- **Owner answers (mobile):** production builds name the production domains only; a restricted public Play listing for customers without Android Enterprise; no budget for now (free EAS tier, local builds, personal devices); no crash reporter — app logs go to our own backend.

### 2026-10-08 — The live database suites repaired and run in CI; migration 0030 no longer rewrites tenant references on a re-run (A-366, A-367) ([record](./records/2026-10-08-live-suites-repair.md))
- **Fixed (A-366):**
  - Migration 0030, when re-run (a restore without `schema_migrations`), treated `access_requests.provisioned_tenant_id` and `upstream_file_imports.target_tenant_id` as tenant owners: NOT NULL and RESTRICT.
  - A restored database with a pending access request would have refused to boot. Without one, every new access request would have failed to insert.
  - 0030 now touches only `tenant_id` / `tenantId`. Fail-before unit and live tests.
- **Repaired:**
  - Eight live suites that were failing unnoticed: `dataIntegrity.p6` (every case since 0110), `dataIdentity.dbA`, `attachmentService.p918`, `inspectionCatalogue.p2003` (stale since later migrations and the storage cut-over), and `queryCount.p804`, `dataLayer.dbC`, `dataLayer.dbD`, `tenantHookless.w34` (each assumed a pre-built database and now builds its own).
  - No assertion was loosened.
- **New:** `npm run test:live` runs every live suite on a fresh database each (36 runs, MQTT included), and CI job `live-db` runs it on PostgreSQL 18 with Mosquitto 2 (not yet run on GitHub). `liveSuites.a367.guard` fails a new live suite the runner does not know.

### 2026-10-08 — Shared packages and the backend for mobile planned (ADR-134); the mobile plan is Phases 35 … 40 ([record](./records/2026-10-08-shared-packages-mobile-backend-docs.md))
- **Docs (target, not built):** `docs/SHARED/` — eight cross-platform packages (contracts, tokens, api-client, i18n, domain, sync-engine, headless hooks, icons) holding logic and design tokens only, in `packages/*`; the web migrates onto them without behaviour change; the API client is generated from the contract-first `contracts/` folder (ADR-136). `docs/MOBILE/20` (today's backend) and `21` (Go engine): a native ingress, install sessions with refresh-reuse detection, tenant lookup by organisation code, hospital SSO through an app link, native passkeys, push via FCM/APNs, a minimum app version (426), device attestation.
- **Supersedes:** ADR-089's root `shared/`, shared UI components and per-backend frontend adapter (banners on `docs/ARCHITECTURE/11`, `12`, `docs/FRONTEND/12`, `13`); Q-48's planned move of `packages/contracts`.
- **Plans:** Phases 35 … 40, 56 cards (P36-14 added by audit round 1), all BLOCKED behind the contract group (Phases 32 … 34). Owner questions Q-58 … Q-61.

### 2026-10-08 — The native mobile app planned (ADR-135); Go-variant mobile phases 1000 … 1002 ([record](./records/2026-10-08-mobile-app-docs.md))
- **Docs (target, not built):** `docs/MOBILE/` — an Expo + EAS React Native app for Android and iOS, phone and tablet, beside the offline PWA: screens per role, tablet split view, offline field capture on an encrypted SQLite store, camera/QR, push without personal data, SSO/passkeys/biometric unlock, internal distribution (Apple Business Manager, Managed Google Play), signed over-the-air updates, Maestro tests.
- **Owner decision folded in:** a tenant setup screen before sign-in (organisation code, setup QR/link, MDM, or work email); the tenant's logo and colour apply in the app; one build for every tenant.
- **Plans:** Phases 1000 … 1002 (Go variant, after Phase 999; restructured the same day into one file, `PHASE-1000-MOBILE-BACKEND-GO.md`), 30 cards, all BLOCKED. ADR-127's "no native app" superseded; the PWA stays.

### 2026-10-08 — Upstream adoption: client facilities in the database (P20-07, migrations 0117 – 0123); ADR-124 Am. 3 ([record](./records/2026-10-08-p20-07-client-facilities.md))
- **Built:**
  - `client_facilities`, with one self facility per tenant, created at migration and by every tenant-creation path (audited).
  - `client_facility_id` on devices, records, certificates, work orders, IoT readings, non-conformances, attachments, warehouses, users and audit rows, back-filled to each tenant's self facility.
  - Composite keys tie every child to its device's facility and cascade a device move.
  - Triggers keep the column immutable outside a move, guard user binding and its role set, and refuse new rows in an ended facility.
  - The attachment rule (AM-7), checked at commit.
  - Serial numbers are unique per facility (UD-9).
- **Existing tenants notice nothing:** the database fills the facility on insert (ADR-124 Am. 3) while a tenant has only its own facility. Nothing outside the database is facility-aware yet; the hooks and routes come with P21-09.
- **Operations:**
  - Deploy this release with **Recreate**: an old replica cannot insert devices after 0118.
  - The back-fill took about 76 s for 100k devices and 1M IoT readings on a workstation.
  - An upgrade refuses a database holding a work order, record, certificate or reading on another tenant's device until that row is repaired.
- **Plans:** P20-07 DONE. Upstream group: 33 of 98 cards DONE.

### 2026-10-08 — Upstream adoption: the IPM report and offline field capture specified; ADR-126 Am. 2, ADR-127 Am. 1 ([record](./records/2026-10-08-p19-06-08-specs.md))
- **Specs (target, not built):**
  - P19-06, the IPM report: number, verification, integrity hash, electronic signatures of the technician and the IPSRS, the PDF and the on-screen report, all rendered in the browser.
  - P19-08, offline field capture: the `/field` app, its service worker, the encrypted offline store, sync and conflicts, photos and QR scanning, purge rules, shared phones, installation and updates, real-device tests.
- **Decisions (working, under the owner's delegation):**
  - The IPM report is a document of the IPM itself, not a certificate.
  - Its public verification needs the token printed in the QR.
  - The technician signs online after submitting; the facility's IPSRS countersigns where the tenant enables it.
  - Offline mode lives only under `/field`, and one field user is allowed per phone profile.
- **Plans:** no card changes state (P23-02 and P22-10 still wait on their build prerequisites). Upstream group: 32 of 98 cards DONE.

### 2026-10-08 — Upstream adoption: the IPM session, the device register's extensions and calibration dates specified; ADR-126 Am. 1, ADR-132, ADR-133 ([record](./records/2026-10-08-p19-02-03-05-specs.md))
- **Specs (target, not built):** P19-02 (IPM sessions and results: states, corrections, voids, visit numbers, side effects, "due", offline idempotency), P19-03 (QR, condition, rooms, photos, QR lookup), P19-05 (calibration dates and due dates).
- **Decisions (working, under the owner's delegation):** the QR is set only by provider staff, normalised with a per-tenant prefix; condition is separate from status; rooms are facility rooms; a void of an IPM reverses only its own maintenance record; the quick calibration entry stores no file.
- **Defect found, fix decided (not built):** a device's next calibration date moves backward when an older record is entered, and corrections and voids never update it (BACKLOG G-11; ADR-133; P21-05).
- **Plans:** P19-06, P19-08, P20-02, P20-04, P20-05, P20-08, P24-04 unblocked. Upstream group: 30 of 98 cards DONE.

### 2026-10-08 — Upstream adoption: every open decision carried as a working decision; roles, grants and the two-facility test plan specified; the "what changed" note in Indonesian; ADR-131 ([record](./records/2026-10-08-phase12-18-29-docs.md))
- **Decisions (working, under the owner's delegation of 2026-10-08; the owner may revise):**
  - Technicians (`TECHNICIAN`, `HEALTHCARE TECHNICIAN`) will get `calibration` write in **every** tenant (UD-4 (b)) — device registration and calibration records; voiding a calibration record moves to tenant administrators in the same release. **Not built yet** (P20-06); its record must state the effect on existing tenants.
  - A client facility that leaves is offered a browser-rendered handover package; ending deletes nothing; its staff accounts are deactivated after 30 days (UD-18 (b)).
  - UD-2, UD-5, UD-7, UD-8, UD-10 … UD-13, UD-15 … UD-17 and Q-57·T (b)–(d) taken as recommended. Still the owner's: the legal basis and contracts (OA-5) and the facts/actions OA-1 … OA-8.
- **Plans:** P12-01 and Phase 18 complete (role matrix with deterministic import rules, grants spec, two-tenant / two-facility test plan); P12-05, P12-06, P19-02, P19-03, P19-05, P20-06 unblocked. Upstream group: 27 of 98 cards DONE.
- **Docs (Indonesian):** `docs/UPSTREAM/11-WHAT-CHANGED-ID.md` for facility and provider staff.
- **Frontend (proposed, not built):** ADR-131 — the public pages get their own root layout and stylesheet (P10-18); the API layer of three public forms loads on demand (P10-19).

### 2026-10-07 — CI on `fe66b79`: a gitleaks false positive and `sharp` 0.35.5 ([record](./records/2026-10-07-ci-fe66b79.md))
- **Security (dependencies):** `sharp` 0.35.4 → 0.35.5 (HIGH GHSA-wq5f-xc86-pv6w, the librsvg it bundles; pulled in by `next`).
  - The lockfile changed only for `sharp` and its `@img/*` binaries.
  - `npm audit --omit=dev --audit-level=high` and `npm-audit-gate.js` both exit 0.
  - `next build` passes, and the image optimiser serves WebP.
- **CI (secret scan):** one false positive is fingerprinted in `.gitleaksignore`: a Debian package name and its size, in the rsync-import record, which the `generic-api-key` rule read as a key.
  - **No real secret is in the history** (gitleaks 8.30.1, 62 commits).
  - No rule was widened.

### 2026-10-07 — Public pages paint sooner; `/login` loads its API code on demand (P10-17 perf addendum; [record](./records/2026-10-05-landing-warm-redesign.md#addendum-2026-10-07--first-paint-and-lcp-of--and-login-ac-5ac-6))
- **Performance (frontend):**
  - The landing lays out only its hero before the first paint; the sections below use `content-visibility: auto`.
  - Public pages no longer inherit the dashboard's Inter font features. The glyphs are identical, and text shaping is about 30 % faster.
  - The grain texture is inlined (one request fewer per public page).
  - The demo QR's path is about half as long.
  - `/login` fetches axios and the auth store at the visitor's first input in the sign-in panel instead of at load: first-load JS 154.2 → 130.9 KB brotli.
- **Measured:**
  - Lighthouse, mobile, simulated, interleaved: `/` Performance 88 → 89, LCP 3.61 → 3.42 s; `/login` 93 → 92, LCP 3.11 → 2.95 s.
  - Real browser at 4× CPU and 1.6 Mbps: `/` LCP 2.58 → 1.87 s; `/login` LCP ≈ 1.0 s.
- **Still not met:** doc 20 AC-5/AC-6 under simulation.
  - The framework's JavaScript lands before the first presented frame on this host, which floors `/login` at 2.77 s.
  - `/` with no JavaScript is 2.64 s.
  - Proposed next: the same on-demand loading for `/request-access`, `/forgot-password` and `/invitation`; a public-only global stylesheet (needs an ADR).
- **Changed outside the public files:** `app/sso-callback/page.tsx`, one import line (`destinationAfterSignIn` moved to `app/login/hooks/destination.ts`).

### 2026-10-07 — Upstream adoption: the SQL-dump import (P24-06; [record](./records/2026-10-07-sql-dump-import-module.md), ADR-129)
- **Added (owner request):** Dashboard → Organisation → **SQL Dump Import** (`/dashboard/upstream-sql-import`, super admin only, ID/EN with its own language toggle) and `/api/v1/admin/upstream-sql-imports`: upload a `mysqldump` / MariaDB dump (`.sql` or `.sql.gz`, ≤ 200 MB) with progress, the runs (polled while one is in flight), a run's per-table counts and reasons, cancel and retry, and an in-app + e-mail notification with counts when it is loaded, fails or is cancelled.
- **Security:** the dump is **parsed, never executed** — a streaming reader of `CREATE TABLE` and `INSERT … VALUES` only, every other statement counted and discarded (fuzz- and property-tested); content-sniffed, SHA-256, ClamAV (fail-closed) before parsing; staged by a separate role `callibrator_import` into the schema `upstream_import`, which `callibrator_app` cannot read or write (proven as that role on PostgreSQL 18).
- **Privacy:** 07-DATA-MINIMISATION as a deny-by-default policy — credential columns of `users` never created or bound, `auth_logins` and the credential tables never extracted, unknown tables not extracted; counts and codes only in the run, audit rows, notifications and logs; the file deleted once loaded, cancelled or infected (a failed run's kept 7 days for a retry, then swept).
- **Gate:** `UPSTREAM_REAL_DATA_ALLOWED` (default off, shared with the rsync import) — only a file declared synthetic until the DPIA gates are met (403), re-checked by the worker.
- **Database:** migrations `0114` (`upstream_sql_imports`, the import role, the closed staging schema) and `0116` (the menu entry). **Deploy:** nginx gives the one upload path 210m, unbuffered, 15 minutes; the Next proxy and the backend give it the same long budget; the hourly sweep is off on API pods (Helm).
- **Not yet:** stage 2 (staging → the application's tables) — designed in ADR-129 § 10, needs Phase 20.
- **Boards:** P24-06 DONE. 22 DONE · 1 WIP · 5 TODO · 70 BLOCKED of 98.

### 2026-10-07 — Upstream adoption: the rsync image import (P24-07; [record](./records/2026-10-07-rsync-image-import-module.md), ADR-130)
- **Added (owner request):** Dashboard → Organisation → **Upstream Import** (`/dashboard/upstream-import`, super admin only, ID/EN) and `/api/v1/admin/upstream-file-imports`: a source form (host, port, user, password or — recommended — SSH key, remote path, file classes), **check connection** (the server's host-key fingerprint shown and confirmed by the operator, then a pinned login and a per-class estimate), a background import over rsync with progress and cancel, and an in-app + e-mail notification with counts when it completes, fails or is cancelled.
- **Security:** never a shell (fixed argument vectors, values after `--`, `--protect-args`); the password only in sshpass's environment, never argv (proven live from `/proc`); SSRF guard on every resolved address (`RSYNC_ALLOWED_HOSTS` for a private test host); the credential KMS-encrypted, bound to the row and erased with the import's end in the same transaction (a database CHECK refuses a terminal row that keeps one); never logged, audited or answered.
- **Files:** only `foto_depan`/`foto_sn` (certificate PDFs never); a quarantine first, then 08-FILE-POLICY's ingest — magic bytes, size, ClamAV, SHA-256, structure, **GPS/XMP/IPTC removed losslessly**, read-back verify — into `t/<tenant>/attachments/`, with a manifest for the ETL; refused files (the shell script, HEIC until P21-02, …) kept by reason, never ingested.
- **Gate:** `UPSTREAM_REAL_DATA_ALLOWED` (default off, shared with the SQL-dump import) — only a synthetic source on an allow-listed host until the DPIA gates are met.
- **Database:** migrations `0113` (`upstream_file_imports`) and `0115` (the menu entry). **Image:** rsync, openssh-client, sshpass (+9.4 MB installed).
- **Boards:** P24-07 DONE. 21 DONE · 1 WIP · 5 TODO · 70 BLOCKED of 97.

### 2026-10-07 — Upstream adoption: the inspection catalogue's schema (P20-01, P20-03; [record](./records/2026-10-07-p20-01-03-catalogue-schema.md), ADR-125 Amendment 2)
- **Added (database):** migration `0111` — `device_types` (global) and `calibration_devices.device_type_id` → RESTRICT; migration `0112` — `inspection_item_definitions`, `inspection_templates`, `inspection_template_versions`, `inspection_template_items` (global) and `inspection_template_proposals` (tenant-scoped), with CHECKs, the one-published / one-draft / one-base unique indexes, ten immutability and no-delete triggers (ENABLE ALWAYS, every role), no DELETE for `callibrator_app` except on a draft's items, and the neutral **base checklist version 1** published by `system:catalogue-seed` with its content hash and APPROVE audit row. Both run on an upgrade boot (proven from the `zed378/calibration-be:25521ff` image's schema).
- **Added (code):** six models; `@callibrator/contracts` catalogue vocabularies, section registry and `canonicalTemplateVersion`; 18 new schema-verify control objects (31 in all) — a boot now refuses a database missing them.
- **Decided (ADR-125 Am. 2):** draft items keep DELETE (the spec contradicted itself); catalogue decimals read as exact strings (a reviewed D-21 exception); device index `(device_type_id, tenant_id)` (D-20).
- **Not yet:** no route or service — the API, limit parser and evaluator are P21-01.
- **Boards:** P20-01, P20-03 DONE. 20 DONE · 1 WIP · 5 TODO · 70 BLOCKED of 96.

### 2026-10-07 — Upstream adoption: client facilities specified (P19-04; [record](./records/2026-10-07-p19-04-client-facilities-spec.md), [spec](./specs/P19-04-client-facilities.md), ADR-124 Amendment 2)
- **Added (documentation only, target):** the `client_facilities` entity and lifecycle (active / inactive / ended, one always-active self facility per tenant), `client_facility_id` on every evidence table with composite keys, CHECKs and triggers, a seven-migration back-fill plan to each tenant's self facility, the second scope dimension in every hook branch, the route gate, the raw-SQL facility clause, sockets/caches/storage keys/signed links, user binding (sessions revoked on change), an audited device move whose history follows the device, the API and contracts, admin UI requirements, import implications, and a test plan mapped to the pre-invitation gate G-01 … G-31.
- **Corrected:** ADR-124 as written would have required a facility on every existing create path, kept a moved device's history in the old facility against its own composite keys, and soft-deleted facilities (hiding their devices from includes). Amended as target: DATABASE/00, SECURITY/05, UPSTREAM/04, 05.
- **Open for the owner:** UD-18 (b) — what a leaving facility receives and how long its records are kept after `ended`.
- **Operational note for P20-07:** that release deploys with `Recreate` (no mixed-version replicas).
- **Boards:** P19-04 DONE; P20-07 unblocked (TODO). 18 DONE · 7 TODO · 1 WIP · 70 BLOCKED of 96.
- **Not changed:** no code, migration or test.

### 2026-10-07 — Signed attachment links bounded and bound to tenant and issuer; socket scope drift; bulk-update tenant values (A-365, threat model F-1/F-2/F-4; [record](./records/2026-10-07-f1-signed-url-ttl.md), ADR-128)
- **Security (client-visible):** `POST /api/v1/attachments/:id/signed-url` takes a lifetime of 30 s to the cap (`ATTACHMENT_URL_MAX_TTL_SEC`, default 900 s, never above 3600 s); above it, **400** (it used to accept any positive number). The default stays 300 s.
- **Security:** a signed link is bound to its tenant and to the principal that minted it, and stops working (404) when the file is deleted or moved, the tenant is suspended, or the issuer is deactivated; a tampered or expired token is 403; links minted before this change are refused. The storage layer's presigned/local URLs are clamped the same way.
- **Security:** an open socket whose user's tenant, super-admin status or role changed is disconnected at the next 60 s re-check (a demoted super admin kept every tenant's notifications). A bulk update inside a tenant can no longer move rows to another tenant.
- **Frontend:** kanban image thumbnails no longer ask for one-hour links.
- **Docs (working decisions under the owner's delegation):** threat-model open questions OQ-1 … OQ-12 (`docs/SECURITY/15` § 13.1; ADR-124 Am. 1 wins on OQ-2 and OQ-9); AM-11/G-09 without `denyPlatformAuthoring`; UD-4 (a)(b)(c) — (b) `calibration` write for the technical roles **awaits the owner's confirmation before its seed migration ships**; P18-01/P18-02 unblocked (17 DONE · 1 WIP · 7 TODO · 71 BLOCKED of 96); `docs/UPSTREAM/05` § 3.1 step 1 drift corrected (`client_facilities ← mst_faskes`).

### 2026-10-07 — Upstream adoption: facility scope ↔ permissions (P18-03; [record](./records/2026-10-07-p18-03-role-mapping.md), [spec](./specs/P18-03-facility-scope-permissions.md), ADR-124 Amendment 1)
- **Added (documentation only, target):** what a facility-bound user may hold and reach — a **bound menu ceiling** inside the one effective permission (sidebar, buttons and API agree; no override lifts it); a bound `HEALTHCARE ADMIN` is read-only; the facility-accessible route list (self routes, device/record/certificate/work-order/attachment reads, the facility technician's device and IPM writes) as one reviewed constant whose guard refuses tenant-admin `rbac`/`abac`, administrative slugs, certificate issuing and anything beyond the ceiling; `FACILITY_READABLE` (own facility row, own sessions, notifications, consent, data-subject requests); reviewed `skipFacilityScope` for settings, KMS and quota reads; the upstream group → role → slug × action × scope matrix; separation of duties for IPM (countersigner ≠ submitter, UD-17); API keys, SSO, SCIM rules; the guards and tests.
- **Planned slugs, no new role:** `ipm`, `ipm-templates` (under Equipment), `client-facilities` (Management › Organization); `ipm` write to the technical roles.
- **Open for the owner:** UD-4 (b) `calibration` write for `TECHNICIAN`/`HEALTHCARE TECHNICIAN` by default (recommended yes — today no technician can register a device); UD-4 (c) facility user management by a bound admin (recommended no).
- **Corrected:** `docs/UPSTREAM/01` § Role Mapping still described facility tenants and the `equipment` gate; `docs/PLAN/03` named `roleConstants.js`. Amended as target: UPSTREAM/01, PLAN/03, SECURITY/05, the Phase 12 DoD.
- **Boards:** P18-03 DONE; P18-04 and P19-04 unblocked (TODO). 17 DONE · 5 TODO · 1 WIP · 73 BLOCKED of 96.
- **Not changed:** no code, migration or test.

### 2026-10-07 — Upstream adoption: threat model of the faskes scope and the offline PWA (P17-06; [record](./records/2026-10-07-faskes-scope-threat-model.md))
- **Added (documentation only, target):** `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` — STRIDE over 24 enforcement points of ADR-124's facility dimension and ADR-127's PWA (FT-01 … FT-109), LINDDUN, findings in today's code (a bound `HEALTHCARE ADMIN` passes every `rbac([TENANT_ADMIN])` gate; SSO JIT/SCIM create unbound users; signed URLs with an unbounded TTL; every socket joins the tenant room; the dashboard cache key is per tenant), 29 proposed ADR additions (AM-1 … AM-29, e.g. a binding change revokes sessions), the **pre-invitation gate** (G-01 … G-31) and the P17-07 test cases (PT-01 … PT-33). Referenced from SECURITY/01, SECURITY/05, docs/README; Phase 17/12 and PROGRESS updated (16 DONE · 4 TODO · 1 WIP · 75 BLOCKED)
- **Not changed:** no code, migration, test or ADR.

### 2026-10-07 — Upstream adoption: the inspection catalogue specified (P19-01; [record](./records/2026-10-07-p19-01-domain-spec.md), [spec](./specs/P19-01-inspection-catalogue.md), ADR-125 Amendment 1)
- **Added (documentation only, target):** the spec of the global, versioned inspection catalogue — device types, the item library, templates with immutable published versions, tenant proposals, typed items and a shared limit parser/evaluator in `@callibrator/contracts`; routes, Zod contracts, gates, audit rows, triggers and a test plan.
- **Corrected:** `docs/UPSTREAM/04` § 5 mapped the physical check and consumables `-1` to "not applicable"; the upstream prints heavy damage / empty. The catalogue read gate is `calibration`, not `equipment`. The catalogue tables are not soft-deleted (a `defaultScope` would have hidden sessions of retired types). Amended as target: UPSTREAM/02, 04, 05, 07; DATABASE/00; the Phase 12 DoD.
- **Boards:** P19-01 DONE; P20-01 and P20-03 unblocked (TODO); P21-01 also depends on P20-06. 15 DONE · 5 TODO · 1 WIP · 75 BLOCKED of 96.
- **Not changed:** no code, migration or test.

### 2026-10-07 — Phase 11 follow-up: the public error/auth pages on the theme tokens; no colour-only status chip (ADR-122 Amendment 1; [addendum](./records/2026-10-06-p11-palette-theme.md#12-addendum-2026-10-07--the-two-items-left-open))
- **Changed:** the 404 page, the OAuth consent screen and the SSO callback lose the copper→teal gradient — copper primary with its hover/pressed tokens, plain page background, light and dark. The colour guard now covers every page and component (public surface included) and refuses a two-hue gradient.
- **Changed:** every remaining status chip shows the status-tone grammar (shape, icon, word, colour): calibration compliance, legal hold, feature flags, consent, MFA, network security, reports, roles/SCIM/workflows/webhooks active, SOP and approval status, vendor approval, menu assignment, kanban over-WIP, system-health tiles and verdict, audit security events. Priority, severity, risk RPN and supplier score bands are neutral chips with the priority-ramp dot; audit verbs, plan tier, role level, adjustment and backup types are neutral chips. `Badge` no longer has `success`/`warning`/`danger` variants; a new guard (`statusChips.p1105`) keeps it so.
- **Not changed:** no backend, API, layout or copy (labels are the words each page showed).

### 2026-10-07 — Upstream adoption plan split into Phases 12 … 31; second batch of owner decisions (Q-57; index [`TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md), ADR-124, ADR-126)
- **Changed (owner instruction, documentation only):** `TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md` split into one file per phase, `TASKS/PHASE-12-…` … `PHASE-31-…`, and deleted. Draft phase `UP-xx` → Phase 12 + xx; card `UP-xx-yy` → `P(12+xx)-yy` (mapping: Phase 12 § 7). 96 cards carried over unchanged: 14 DONE · 1 WIP · 4 TODO · 77 BLOCKED. References rewritten in `TASKS/` (PROGRESS, README, BACKLOG, PHASE-999), `docs/UPSTREAM/`, `docs/README.md`, `docs/PLAN/16`, `docs/ARCHITECTURE/11`, `docs/BACKEND/12`, `MEMORY/DECISIONS.md` (ADR-124 … 127), `CLAUDE.md`, `AGENTS.md`; dated records keep their `UP-` ids under a one-line note.
- **Decided by the owner, 2026-10-07 (all as recommended):** a tenant is whoever does the calibration work — a calibration company serving many facilities, or a hospital IPSRS serving itself with one `is_self` facility (Q-57·T (a), confirms ADR-124; (b)–(d) stay open); serial numbers unique per facility (UD-9); external-lab certificate PDFs archive-only, with an optional later data-entry pass for the latest certificate per device; the GDPR export (ADR-114) stays a backend ZIP. No card unblocked.
- **Not changed:** no code, migration or test.

### 2026-10-07 — Upstream adoption: tenancy corrected by the owner; ADR-124 … ADR-127 written (UP-00-02/03/04/07, UP-16-02; [record](./records/2026-10-07-upstream-adrs.md))
- **Decided (owner, correcting UD-1 the same day):** the tenant is the calibration company; health facilities are its clients. **ADR-124:** a facility is a `client_facilities` row inside the tenant; a facility's own staff are users bound to it by a second, deny-by-default scope in the tenant hooks (cross-facility = 404; other tenant tables answer nothing to them; routes deny-by-default; storage keys carry the facility). No cross-tenant access is added; ADR-084 stands. A hospital doing its own calibration stays a tenant with one facility, itself (awaiting confirmation, Q-57·T).
- **ADR-125:** one global, versioned device-type and checklist catalogue; published versions immutable; sessions pin a version; operator-only writes. **ADR-126:** an IPM session is an issued record — many per device, corrections supersede, voids are final, nothing deleted; "due" is computed; the IPM report and every export are rendered in the frontend (owner rule), no stored file. **ADR-127:** field capture is a PWA with an encrypted per-user offline queue replaying the normal API idempotently.
- **Changed (documentation only, all marked target):** PLAN/00, 03, 10; SECURITY/05, 12 (UU PDP 3 × 24 h breach notice); MULTI-TENANCY/README; DATABASE/00; FRONTEND/00; UPSTREAM/00, 02, 04, 05 (superseded notes; photos only ≈ 91 GB). The plan's cards and totals updated (14 DONE · 4 TODO · 1 WIP · 77 BLOCKED); 15 open questions carried as Q-57·T and Q-57·UD-n.
- **Not changed:** no code, migration or test. Implementation stays blocked on the open owner decisions and actions.

### 2026-10-07 — Upstream adoption: DPIA, data minimisation, file policy, report layouts and the owner's security checklist (UP-05-02/04/05, UP-11-01; [record](./records/2026-10-07-upstream-privacy-and-reports.md))
- **Added (documentation only, no code):** `docs/UPSTREAM/06-DPIA.md` (UU PDP 27/2022 impact assessment, pending legal review), `07-DATA-MINIMISATION.md`, `08-FILE-POLICY.md`, `09-REPORT-LAYOUTS.md` (structure only), `10-OWNER-CHECKLIST.md` (Indonesian, for the live upstream and the local copy). No real data value in any of them.
- **Applied two owner corrections:** the tenant is the calibration company and each facility a client entity inside it (roles re-derived; the facility scope is the separation control to prove with two-faskes tests); certificates and exports are rendered in the frontend, so the upstream's ~11.9 k certificate PDFs go to an encrypted offline archive only and storage receives device photos only (~91 GB). Finding F-CERT: the external certificates' content exists only in those PDFs.
- **Changed:** `docs/UPSTREAM/02-FEATURES.md` F-58, F-65, F-66 marked superseded where they proposed backend PDF/XLSX generation (contradicts ADR-095 and the owner rule).
- **Not changed:** implementation remains blocked; the owner actions OA-1…OA-3 are now a step-by-step checklist awaiting confirmation.

### 2026-10-07 — Upstream PHP Feature Adoption: the upstream researched, the phase planned, four owner decisions taken (Q-57; records [code](./records/2026-10-07-upstream-code-research.md), [database](./records/2026-10-07-upstream-database-research.md); plan `TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md`, split 2026-10-07 into Phases 12 … 31 — [index](../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md))
- **Added (documentation only, no code):** `docs/UPSTREAM/` 00–05 + README — the upstream SKP IPM CodeIgniter 4 app (device inventory + IPM for one provider and 118 facilities): 15 modules, 81 features, 18 security findings (location and type only), 52 tables, ~384 k rows, 116 GB of files; target schema in our conventions and an ETL plan. No real data value in any of them.
- **Added:** the phase plan — the code agent's UP-00…UP-19 and the DB agent's UP-DB-1…9 merged into 20 phases and 96 cards; owner decisions D-1…D-11 and the code agent's six merged into UD-1…UD-18; owner actions OA-1…OA-8 (rotate the upstream DB password and JWT secret; close registration, development mode, `info.php` and the public QR/PDF routes on the live upstream; encrypt and later delete the local copy; scan one sticker; legal basis per facility).
- **Decided by the owner, 2026-10-07:** each facility is its own hospital tenant and the provider acts through a revocable, audited per-facility grant with an "active facility" switch (an ADR amending ADR-084 comes first); many IPM sessions per device with corrections and voids, nothing deleted; field capture as a PWA with offline mode; one global, versioned device-type and checklist catalogue.
- **Changed:** `docs/UPSTREAM/02-FEATURES.md` table names reconciled to `04-SCHEMA-MAPPING.md` (`inspection_sessions`/`inspection_results`, `qr_code`, catalogue tables, enum values).
- **Not changed:** implementation is blocked on the ADRs, 14 open decisions and the owner actions. Phase 999 stays blocked.

### 2026-10-06 — The landing's verification demo no longer collapses at tablet widths (P10-17 fix, ADR-118, [record](./records/2026-10-05-landing-warm-redesign.md#addendum-2026-10-06--the-verification-demos-layout-at-tablet-widths-owner-bug-report))
- **Fixed:** after "Scan", the demo certificate in `#verifikasi` was squeezed to ~160 px at tablet widths and pushed under the phone. The QR was half hidden, the certificate number broke mid-token, the sample-data tag was cut off and the button wrapped (owner report, 773 px). The phone's width had come from its own content, so the verdict's sentence widened its column. Every width is now fixed: the two stack until both fit side by side, and desktop keeps its composition. The phone no longer changes size between idle and verified (a layout shift at every width before).
- **Changed:** the certificate number breaks only after a hyphen (`<wbr>`), never mid-token.
- **Added:** `automate/responsive.browser.js` checks the demo at 15 widths (360–1536), ID/EN, light/dark, idle and verified, with and without reduced motion: 90 rows. It looks for overlap, a covered QR (`elementFromPoint` at the corners), mid-token breaks, one-line button and tag, and no size change between states. It found 0/90 clean before the fix and 90/90 after; `RESPONSIVE_SELFTEST=1` detects the planted defects on 90/90.

### 2026-10-06 — The images are published on Docker Hub; deployments pull them, the VM never builds (P7-09, ADR-123, [record](./records/2026-10-06-dockerhub-images.md))
- **Changed:** compose, the Makefile and Helm default to the public images `zed378/calibration-be`, `zed378/calibration-fe` and `zed378/calibration-backup`. The base compose file and the vm, staging and prod overlays build nothing. The VM deploys with `docker compose … pull` then `up -d` (`make deploy-vm`).
- **Added:** `deploy/compose/docker-compose.build.yml`, the one overlay that builds from source (dev, E2E). Its images are named `callibrator/*:local`, never a registry name.
- **Added:** `scripts/release/push-images.ps1`. It refuses a dirty tree, builds backend → frontend → backup, secret-scans every image before any push, pushes the short commit and `latest`, and prints the digests. `-DryRun` builds and scans only; `-ScanTag` re-scans.
- **Added:** pinning by tag (`IMAGE_TAG=<short commit>`, recommended) and by digest (`BACKEND_DIGEST`, `FRONTEND_DIGEST`, `BACKUP_DIGEST`; Helm `image.digest`, refused unless `sha256:<64 hex>`).
- **Changed:** CI also builds the backup verifier image (no push), so all three Dockerfiles are built on `main`. `deploy-config` asserts that no deployment overlay builds.
- **Note:** the published frontend is built for `https://kalibrasi.zedth.my.id` only. Another URL needs its own frontend image. An `.env` made before today names `callibrator/backend`/`frontend`, which `pull` cannot find: change those two lines.

### 2026-10-06 — The dashboard turns warm; one light/dark switch for the whole product; status badges carry a shape and an icon (P11-01 … P11-07, ADR-122, [record](./records/2026-10-06-p11-palette-theme.md))
- **Changed:** the dashboard uses the landing's family of colours: a warm off-white page, paper cards, charcoal text and copper buttons and links; espresso, ivory and a light copper in dark mode. Teal now means "verified / compliant" only. A tenant's own brand colour still replaces copper.
- **Changed:** until a user chooses, the dashboard follows the device's light/dark setting, as the public pages already did. A choice made on either side carries to the other immediately. "Use device setting" on the profile page forgets the choice. The dashboard's toggle is larger (40 px) and announces whether dark mode is on.
- **Changed:** every status badge shows an icon and a shape as well as a colour (solid for overdue/failed/revoked, outlined for attention, dashed for draft/inactive), from one registry. A few states changed tone: a retired device or an expired API key is now grey, a suspended tenant or user amber rather than red. Kanban and ticket priority are no longer red/amber/blue: they are a copper scale with the priority's name.
- **Fixed:** unreadable inputs in the tenant backup dialog (dark mode), an invisible SSO dialog heading (light mode), a dropdown panel unreadable in dark mode, faded notification times, the impersonation banner's contrast, form-field outlines too faint to see (1.23:1 → ≥ 3.2:1), kanban priority bars under 3:1, white text on light label colours, and two tables that could not be scrolled by keyboard on a phone.
- **Added:** a build guard that fails on any hard-coded colour in the dashboard outside a reviewed list; the browser suite `automate/p11.browser.mts`.

### 2026-10-06 — CI's third run on `4584df3`: every page order ends in the id; `source-map-js` 1.2.2 ([record](./records/2026-10-06-ci-third-run.md))
- **Fixed:** 42 paginated queries ordered by a column that can tie (`createdAt`, `name`, a sortable column…). Tied rows had no defined order, so paging could show a row twice and skip another. Each order now ends in `id`, in the primary sort's direction; the primary sort is unchanged. SCIM `GET /Users` had no order at all and now lists oldest first, as `/Groups` does. This was found when the access-request queue test failed in CI: two requests were created in the same millisecond.
- **Added:** the guard `pageOrderTiebreaker.ci3.guard.test.ts`. It fails the build on a page query whose order does not end in `id`, or that pages without an order. It found 42 such queries at `HEAD`, including two that the hand audit missed.
- **Changed:** the queue test now freezes `Date` and sets each `createdAt` itself. A new case proves that three rows from the same millisecond list and page in id order, each exactly once (fail-before: the first two swap).
- **Security:** `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q, HIGH, production). This is a lockfile-only change of one entry. The production audit is at 0 high. Four moderate advisories remain, all one `sprintf-js` chain under `umzug`'s CLI. They have no fix short of a major downgrade and are reachable only from the operator's command line.

### 2026-10-05 — Closing verification of the work since `dded70c`: every gate green, live pair S/T green, 0109–0110 proved on an upgrade boot, `db-backup` verified ([record](./records/2026-10-05-closing-gates-st.md))
- **Verified, no source change:** backend coverage 100/100/100/100 (890 suites, 15,054 tests, 0 failed); lint 0/0; typecheck 0 in four projects; frontend jest 297 suites at 93.94/84.77/89.63/94.6; `next build`, bundle budget 10/10; npm audit gates; gitleaks; compose, Helm (with the backup CronJob) and actionlint.
- **Live:** runs S and T back to back on a fresh production-mode stack: E2E 433/0, smoke 7/7, a11y 80/80, responsive 45/45, P10 12/12; 0 × 5xx.
- **Migrations:** 0109 and 0110 apply on a fresh boot and on an upgrade boot from `dded70c`'s own image (`btree_gin` created by the owner role); reboots after both are clean.
- **Backups:** `db-backup` (ADR-116), enabled once on the pair stack, passed its first restore verification (restore 5 s).
- **Open:** `oasdiff` against `main` reports 3 breaking changes, all `POST /api/v1/sop` (W-10). A pull request needs them recorded; a direct push passes.

### 2026-10-05 — The public pages turn warm, human and interactive: the landing, sign-in and request access redesigned; light and dark modes (P10-17, ADR-118 + Am. 1, 3, [record](./records/2026-10-05-landing-warm-redesign.md))
- **Changed:** the public palette is now ivory, cream, charcoal and copper, with dark teal only as "verified". A warm dark mode follows the app's theme switch, or the system preference when the visitor has not chosen. The toggle is in the public header, the mobile menu and the sign-in pages.
- **Changed:** the landing was recomposed:
  - a full-bleed hero photo, and a gauge needle that follows the pointer;
  - the survey "moments" as large type, a human moment, and a before/after slider;
  - the six-step story (swipeable on phones);
  - an explorable sample certificate with swipeable explanations;
  - the QR verification demo on a deep-charcoal section;
  - honest proof (no invented testimonials), a typographic capabilities index, a timeline, the FAQ, and a minimal closing.
- **Changed:** sign-in, request access, forgot password and the invitation share a new editorial panel. Their changes are presentation only: a greeting, hints on blur, steps that ease in, calm progress, and a request-access success page with honest next steps. The auth logic, messages and payloads are unchanged, which tests prove.
- **Added:** licensed editorial photographs (Unsplash), each listed in `frontend/public/marketing/ASSETS.md` and doc 20 §12.
- **Changed:** the landing photographs now show medical-device work: a clinician at a vital-signs monitor, a staff member setting a wall monitor, and late paperwork. The product screenshots were re-captured in light theme. The UK-hospital corridor photograph is gone.
- **Not met:** Lighthouse mobile medians are `/` Performance 88, LCP 3.6 s and `/login` Performance 89, LCP 3.2 s, against the 2.5 s and 1.8 s targets. Observed LCP is at most 1.5 s. The cause is late page-level CSS and framework JavaScript under Lighthouse's simulation.

### 2026-10-05 — The logo follows the warm palette; emails follow (P10-17, ADR-118 Am. 2, [record](./records/2026-10-05-logo-warm-recolour.md))
- Changed: the mark, lockups and app icon are charcoal `#1F1B17` + copper `#9A4E22` on light, ivory + light copper `#E3A47B` on dark (copper is 2.74:1 on the warm charcoal). Shape unchanged, byte-for-byte. `favicon.ico`, `apple-touch-icon.png` and `logo-email.png` regenerated. `lockup-mono.svg` unchanged.
- Changed: `BrandIcon`'s accent follows the theme (`--pub-accent`, else the new `--logo-accent`); the dashboard sidebar's logo uses `text-logo-ink`. Nothing else on the dashboard changes.
- Changed: activation, OTP, account and notification emails use the warm palette (cream page, paper card, charcoal text, copper accent bar, button and links). Layout and copy unchanged.

### 2026-10-05 — The dashboard is cached for 30 s per tenant and says when its figures were computed; search reads its permissions once and only its tenant's index entries (U-06b, ADR-120, [record](./records/2026-10-05-u06b-search-dashboard.md))
- Changed: `GET /dashboard/metrics` is served from a 30-second cache per scope (Redis; an in-process fallback when Redis is down; never shared between tenants). `generatedAt` is when the figures were computed, up to 30 s earlier; the dashboard shows "Updated at / Diperbarui pukul HH:MM:SS". p95 at 10 VU: 197–344 → 61–64 ms on the same stack.
- Changed: one search request loads the caller's permissions once instead of six times (13 → 3 Redis GETs); its type checks run concurrently. Every type is still gated by its own list route's permission (A-04).
- Added: migration **0110** — `CREATE EXTENSION btree_gin` and a per-tenant GIN index `(tenant_id, search_vector)` on devices, stock and certificates, replacing 0003's. Operators: the database owner can create the extension without superuser; a migration user that is neither the owner nor holds CREATE on the database must have it created once (`deploy/helm/callibrator/values.yaml`).
- Fixed (before release): migration 0109's `INCLUDE` index made every boot after the one that applied it fail in Sequelize's `showIndex`; it now uses key columns. A development database that applied the old form: drop `calibration_records_tenant_live_date` and recreate it as 0109 now defines it.
- Not claimed: an end-to-end search gain — search met its budget in every run of both images, and the difference is inside the shared host's noise.

### 2026-10-05 — CI: a dev-only audit advisory is allow-listed with an expiry; a failed backend test run names itself in public annotations (ADR-117, [record](./records/2026-10-05-ci-second-run.md))
- Changed (CI): `dependency-audit` is two steps. `npm audit --omit=dev --audit-level=high` covers production with no exceptions. `scripts/ci/npm-audit-gate.js` covers the whole tree: a high or critical advisory passes only through an unexpired, reviewed GHSA entry in `scripts/ci/npm-audit-allowlist.json`, and only while it stays out of production. One entry: GHSA-vfj7-8cjw-p6xm (`braces`, no fix exists, lint tooling only), expires 2026-11-05.
- Added (CI): the backend test step annotates failing tests (jest's `github-actions` reporter). On failure, `scripts/ci/jest-annotate.js` annotates suites that never ran and files below 100%. Both can be read without a token from the check run's annotations.
- Changed (tests): `backend/jest.config.js` recycles a worker whose heap passes 2 GB. Workers leak about 20 MB per route suite; a full run held 12.3 GiB against a 4 GiB per-process heap limit, and now holds 6.6 GiB. The GitHub failure did not reproduce in two Linux runs, so this is the probable cause, not a proven one.

### 2026-10-05 — Every stored file goes through the storage layer; `bootstrap:rotate` works from a checkout (P8-01, ADR-086 Am. 1, [record](./records/2026-10-05-p8-01-storage-cutover.md))
- Changed: attachments, certificate PDFs, avatars, tenant logos, CMS images, tenant backups and GDPR exports are now written to, served from (Range, ETag/304, the same headers), signed from and deleted from the configured storage — `local` (default `/app/storage`), NFS or S3. Before, they were always on the host's disk, whatever `STORAGE_DRIVER` said. Files written before this change are still served from their old paths until `npm run migrate:storage` copies them.
- Changed: `npm run migrate:storage` also copies certificate PDFs, tenant backups and the public images; the two row backfills it makes are audited (`system:storage-migration`). Summary lines per class.
- Fixed: the `local` storage driver failed every write and answered 500 to every read while its root directory did not exist; a 416 from a backup or export download left the client waiting.
- Fixed: `npm run bootstrap:rotate` from a source checkout failed with a missing-environment error; it now reads `backend/.env` first.
- Verified live: two tenants on SeaweedFS through a running backend, 44/44 (`scripts/storage/p801-live-check.sh`). Still blocked on the production bucket/NFS and the ambient IAM credential chain.
- Operators: keep the uploads volume mounted until `migrate:storage` has run; new files go to the storage volume (or bucket).

### 2026-10-05 — U-06 re-measured: the lists meet p95 < 500 ms at 10 users on an uncontended host; the record list joins only its page (U-06, ADR-119, [record](./records/2026-10-05-u06-list-performance.md))
- Measured: the P8-07 stack, script and seed on the current tree, production mode. The four lists had a p95 of 156–438 ms at 10 VU in 8 of 9 runs; the misses were runs on a contended host. The ceiling is now the backend's event loop (main thread 99–100%), not PostgreSQL (165–191% of 16 cores). Global search was measured for the first time and does not meet 500 ms (4 of 7 runs). The certificate document does meet its budget.
- Changed: the calibration-record list counts without joins and joins only the page it returns: page 200 went from 6,592 to 622 buffers. Same rows, order and totals in 8 of 8 identity cases on PostgreSQL 18.
- Added: migration **0109**, a partial covering index of live calibration records. The list's and the dashboard's record counts become index-only (1,510 → 361 buffers). Run it on upgrade. It is built CONCURRENTLY by the boot's migrator.
- Changed: Sequelize's transaction namespace is AsyncLocalStorage, and **`cls-hooked` is removed** (`backend/package.json`, `package-lock.json`). The JWT ring caches its KeyObjects; rotation still applies on the next call.
- Added: `scripts/load/u06-search-document.k6.js`, a load script for global search and the certificate document.
- Not claimed: an end-to-end p95 gain. The interleaved before/after runs stayed inside the shared host's noise.

### 2026-10-05 — A request body without its fields no longer answers 500 (W-10, [record](./records/2026-10-05-w10-bodyless-requests.md))
- Verified: all 196 write routes without a body schema were called with an empty body and with an array body. They were called through the real middleware, controllers and models, as a tenant admin and as the super admin. A missing body or a non-JSON body was already treated as empty, and a JSON value that is not an object or an array was already refused with 400 before any route ran.
- Fixed: `POST /api/v1/sop` answered 500 when the title was missing, the body was empty, or `requiresTraining` was null. It now answers 400 "Validation Error". The body is validated: the title is required (1–255 characters), `version` and `contentUrl` are length-checked, and any other field is ignored.
- Added: a build check (`bodylessRequests.w10.guard`). It fails when a new write route without a body schema answers 5xx to an empty or array body.

### 2026-10-05 — The S3 storage driver ran against real S3 servers; storage usage works on S3 (U-09, [record](./records/2026-10-05-u09-s3-live.md))
- Verified live: the real driver against SeaweedFS and Versity S3 Gateway (MinIO images cannot be pulled here). Health check, objects, ranges, a 16 MiB stream, paging, presigned URLs, tenant isolation and the SSRF guard all passed, 15/15 on each server. A running backend's `/api/v1/storage` and `migrate:storage` passed 28/28.
- Fixed: `GET /api/v1/storage/usage` failed on every tenant with S3 storage: it asked S3 for 9,007,199,254,740,991 keys, which every server refuses. It also counted only the first 1,000 objects. It now pages through all of them.
- Added: `scripts/storage/s3-live-check.sh`, which starts the servers (and, with `APP_PATH=1`, a backend), runs every check and removes the containers it started.
- Not proven: MinIO, AWS S3, the IAM credential chain, multipart upload, and attachments on S3 (P8-01).

### 2026-10-05 — Every nightly database dump is restored and checked; a failed or missing backup alerts (U-05, ADR-116, [record](./records/2026-10-05-u05-backup-restore-verification.md))
- Added: the `db-backup` service (compose) and a Helm CronJob (`backupVerify.enabled`, default off). Every night it takes `pg_dump -Fc` and restores that dump into a throwaway PostgreSQL 18 + pgvector. It then checks the restored copy: checksum, role-first `pg_restore --exit-on-error`, pgvector, exact row counts and audit checksum against the dump's snapshot, and the application's own schema check.
- Added: alerts `backup.dump.failed`, `backup.restore-verify.failed`, `backup.restore-verify.missed` and `backup.restore-verify.unreadable`, sent through the existing log, webhook and email path. The backend watchdog alerts when no verification is recorded for 26 h.
- Added: the backend binary's `verify-schema` and `backup-alert` subcommands.
- Measured: restore-plus-checks 18 s on the proof stack, recorded on every run as `restoreSeconds`.
- Not done: WAL/PITR and off-host copies of the dumps; both are scoped out with triggers.

### 2026-10-02 — CI's first run on `1100658`: three causes reproduced on Linux and fixed ([record](./records/2026-10-02-ci-first-push-fixes.md))
- Fixed (CI): the boot job now gets the `ACCESS_REQUEST_IP_PEPPER` production requires; `scripts/ci/e2e-env.sh` is executable (the deploy-config and browser a11y jobs stopped at exit 126).
- Fixed: `backend/.env.example` no longer sets `SUPER_ADMIN_ROLE_ID=uuid-here`, a placeholder that replaced the seeded super-admin role id for anyone who copied it; a guard keeps it out.
- Fixed (tests): three suites passed only on the workstation — one opened a real database transaction, one depended on the template above, one wrote real files into `backend/exports`. On a clean Linux clone the coverage gate is 100 %, 870 suites, 0 failed.

### 2026-10-02 — Phases 9–10 deployed to the reference VM; it now runs PostgreSQL 18.6 ([record](./records/2026-10-02-closing-deploy-vm.md))
- Deployed: `1100658` at https://kalibrasi.zedth.my.id. The stack and its volumes were wiped first, as the owner directs, and the 32 other projects' containers were untouched.
- Changed: the VM is on PostgreSQL 18.6 (ADR-041 status). The VM's configuration gained the `ACCESS_REQUEST_IP_PEPPER` production now requires, generated on the VM and never shown.
- Verified live: the one-time super-admin password is only inside the container, 0600 and in no log, environment or volume (U-08 steps 1–4). The owner's first sign-in is still owed.
- Fixed (procedure): `deploy/README.md` no longer loses the one-time password when seeding is switched off; the password is issued with the rotation CLI.

### 2026-10-02 — Closing verification for Phases 9–10: every gate green, the live pair green on the final tree ([record](./records/2026-10-02-closing-gates-qr.md))
- Verified: on a quiet tree, backend coverage 100 % (869 suites, 0 failed), lint 0/0, typecheck, builds, load checks, contracts 100 %, frontend coverage gate, `next build` and the bundle budget all pass; gitleaks finds no secret.
- Verified: the full live suite and every browser suite passed in two runs back to back (Q and R) on a production-mode build of the final tree, with no server error. Migration `0108` applies on a fresh database and on an upgraded one.
- **Decided (ADR-115):** the published API description changes in ways the breaking-change check reports (857 items against `main`). Almost all are the description catching up with validation the server already enforced; the 11 "removed" paths are `/e-signature/*`, a prefix the server never served (it is `/esignature`). This is accepted as a one-time reset when the code-first contract reaches `main`. From then on the check keeps its full force.

### 2026-10-02 — Live acceptance green twice on the current tree; three live-run defects fixed ([record](./records/2026-10-02-a346-a348-live-pair-kl.md))
- Fixed: a malformed supplier-scorecard id answers 400 "Invalid id: must be a valid UUID" instead of 500 (A-346).
- Fixed: testing a tenant's S3 storage settings gives up after 5 seconds and reports the failure, instead of waiting as long as the network does (A-348).
- Fixed (tests): the live supplier-scorecard and storage tests match the contract and no longer reach the internet (A-347, A-348); two browser-suite timing races are retried.
- Verified: the full live suite and every browser suite passed in two runs back to back on a production-mode build of the current tree (runs O and P). The backend freeze seen earlier recurred once, and the evidence places it in the Docker host, not the backend (record).

### 2026-10-02 — Every data export is recorded in the audit trail ([record](./records/2026-10-02-gdpr-export-audit.md), A-364)
- Fixed: requesting "Export my data" now writes an audit entry (who, when, which export, its size and expiry — never the data itself). Only the download was recorded before. If the entry cannot be written, the export is discarded and the request fails rather than leaving an unrecorded copy of your data on the server.
- Changed (internal): the audit-coverage build check now treats writing or deleting a file as a change that needs an audit entry, not only database writes.

### 2026-10-02 — Your data export can be downloaded; backups keep their names ([record](./records/2026-10-02-a359-a363.md), A-359 … A-363, ADR-114)
- Fixed: "Export my data" on the privacy page now downloads the export itself — a ZIP of your profile, the records that name you, your consent and requests, and your audit trail. It used to save a small file describing the export instead. Only you can download your export, until it expires; each download is recorded in the audit trail.
- Fixed: the tenant-backup page offers Download and Restore for finished backups again, and its Completed / Failed / In progress counts and status colours are right.
- Fixed: a backup keeps the name and description it was created with (they were silently discarded). Backups taken before this change show "Untitled backup" and are confirmed by their id when restored.
- Fixed: the tenants page's Active and Suspended counts and status colours are right.
- Removed (internal): two unused frontend menu methods that sent fields the server ignores.
- **Operational:** run migration `0108-tenant-backup-name-description` on upgrade (`npm run migrate`; two nullable columns, no rewrite).

### 2026-10-02 — Every frontend service on the generated API client ([record](./records/2026-09-30-p9-stage-c-leaf-services.md) § P9-25 item 11, ADR-103)
- Changed (internal): all 54 frontend API services now type their calls from the published API contract (`openapi-fetch` over the existing axios client). A path, parameter or body the server does not publish is a compile error. Requests on the wire are unchanged, and tests pin them.
- Fixed (documentation): the published contract now matches what the server sends for users, sign-in, MFA set-up, stock transfers, blog posts, e-signature history, GDPR consent and processing, the menu tree, tenant settings, backup restore and the workflow inbox.
- Found (fixed the same day, see above): the GDPR data export cannot be downloaded (A-360). The tenant-backup page never offers Download or Restore (A-362). The tenants page's Active and Suspended counts always read 0 (A-361). Backup names are never stored (A-363). Two unused menu methods send fields the server ignores (A-359).

### 2026-10-02 — Ten screens fixed to show what the server actually sends ([record](./records/2026-10-02-a349-a358-frontend-drift.md), A-349 … A-358)
- Fixed: the devices page no longer crashes after a CSV import with an invalid row. Each rejected row lists its field errors.
- Fixed: the network-security dry run no longer crashes when a geofence is set and no location is entered; it explains that no location was given.
- Fixed: the feature-flags page no longer fails with an error before a tenant is chosen; it lists every flag at its default.
- Fixed: the warehouse form offers only the statuses the server accepts (Active, Inactive), and a warehouse with no status no longer breaks the list.
- Fixed: the predictive-maintenance toast now shows the recommendation's reason.
- Removed: details the server never sends, which only ever showed blank: a board's code on the boards list, card counts on sprint tabs, a job's failed-item count, and a tenant's suspension reason and date on the lifecycle page.

### 2026-10-02 — A broken configuration is reported in full at startup ([record](./records/2026-10-02-p9-06-env-schema.md), ADR-087 Am. 30)
- Changed (operations): when required settings are missing or wrong, the backend now stops once and lists every problem together on its console output, instead of reporting one per restart (and, in production, only in a log file).
- No new requirements: a configuration that started before still starts. The configuration guide and `.env.example` list four settings they were missing.
- Internal: status values for certificates, stock, work orders, CAPA, tenants, webhooks and workflows are defined once and shared (P9-05); the backend lint is at zero warnings, with the remaining rules raised to errors (P9-02a).

### 2026-10-02 — Live acceptance re-run on the current tree; seven Phase 10 cards ready to close ([record](./records/2026-10-02-p10-live-pair-ij.md))
- Verified: request access, the super-admin queue, forgot/reset password, invitations, passkeys, the registration flag and the first-administrator password work end to end on a production-mode build of the current tree, including the newly converted TypeScript entry point.
- Found: a malformed supplier-scorecard id answers 500 instead of 400 (A-346); two live tests are stale or depend on reaching AWS (A-347, A-348); the backend froze for up to 69 s twice during the run (cause open).

### 2026-10-02 — Attachments, maintenance, menus and seeding moved to TypeScript; two dead code paths removed ([record](./records/2026-10-01-p9-19-middlewares-core-services.md), ADR-087 Am. 29)
- Changed (internal): the attachment, maintenance work-order, menu-group and seeding services are TypeScript; behaviour is unchanged, proved module by module and, for attachments and seeding, on a live database.
- Removed (internal): an after-response audit middleware no route used, and two unused session-revocation helpers that could not have worked (A-340). Audit rows are written inside each change's transaction, as before.
- Verified: deleting an attachment removes its file only after the change is saved; demo data with calibration records is never removed; the platform tenant is seeded once.

### 2026-10-02 — The backend entry point, its configuration and its maintenance commands are TypeScript ([record](./records/2026-10-01-p9-21-non-route-files.md), ADR-087 Am. 28)
- Changed (internal): the server entry point (`backend/index.ts`), the database, migration and realtime configuration, the operator CLIs (`npm run migrate*`, `keys:rotate`, `migrate:storage`, break-glass MFA reset, demo seed, embeddings backfill) and the documentation generators are TypeScript. Commands, output and exit codes are unchanged.
- Changed (**operational**): `npm start` / `npm run dev` run `index.ts`; the release build still produces `dist/index.js`, so images and binaries start as before.
- Removed: `backend/scripts/rotate-default-credentials.js`, which could never run (A-344); `npm run bootstrap:rotate` does that job.
- Fixed (tests): the live realtime fan-out test across replicas runs green again (A-345).

### 2026-10-01 — Request access stays closed until a privacy notice is published; SSO survives an identity-provider key rotation; the product is "Device Calibrator" in the dashboard too ([record](./records/2026-10-01-p10-a341-q43-privacy-ac4.md), ADR-113)
- Changed (**operational**): the public access-request form and `POST /api/v1/access-requests` exist only while `PRIVACY_NOTICE_URL` names the published privacy notice. Unset (every deployment today, the VM included), `/request-access` says requests are not open yet and offers the contact channels, the endpoint answers 404, and the footer has no privacy link. Set it in `.env` (Compose) or `global.privacyNoticeUrl` (Helm) once the notice is published; no rebuild needed.
- Fixed: an OIDC identity provider that rotates its signing key no longer breaks that tenant's single sign-on for up to six hours (A-341): an unknown key id refetches the key set once, at most once a minute.
- Changed: the dashboard sidebar, the authenticator-app label for new MFA enrolments, the passkey prompt, PDF metadata and the GDPR export now say "Device Calibrator" (Q-43).
- Added: screenshots of every public page from 320 to 1920 px and at 200 % zoom and 200 % text size (`docs/UI-UX/research/screens/ac4-*`) — none scrolls sideways or clips or overlaps text — and a browser check that keeps it so (`automate/responsive.browser.js`, part of `make test-browser`).

### 2026-10-01 — Sign-in, permission and audit code moved to TypeScript; three audit behaviours now tested ([record](./records/2026-10-01-p9-19-middlewares-core-services.md), ADR-087 Am. 27)
- Changed (internal): authentication, permission checks, attribute-based access, quota enforcement, the scheduled jobs, the batch-job worker, and the Redis, e-mail queue, MFA, rate-limiter and audit services are TypeScript. Behaviour is unchanged: proved module by module, and live on PostgreSQL 18 for authentication and the audit trail.
- Verified: when an audit row cannot be written, an account lock is still applied; audit lists keep entries made by the system or by deleted users. Both are now covered by tests.
- Found, not yet fixed: two unused token-revocation helpers in the rate limiter would not work if called (A-340).

### 2026-10-01 — Single sign-on tested end to end in a browser; the accessibility suite gets a CI job ([record](./records/2026-10-01-p10-13-sso-a11y-ci.md), P10-13, M-14)
- Verified: signing in with a work email whose domain uses single sign-on (OIDC) now has a browser test that follows the real redirect to the identity provider and back to the dashboard.
- Internal: the accessibility browser suite waits for the dashboard's entrance animations, removing an intermittent false failure, and has a CI job against a disposable stack (not yet run on GitHub).
- Found, not yet fixed: if an organisation's identity provider changes its signing key, single sign-on can fail for up to six hours (A-341).
- Open before release: the privacy notice (the request-access consent already refers to it), the legal review, the contact details and the legal entity.

### 2026-10-01 — Risk, supplier-scorecard and asset-finance writes are validated and tenant-checked ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 6)
- Security: a risk or scorecard request can no longer set server-owned fields (id, organisation, author, timestamps); they are ignored (A-335, A-336).
- Security: a scorecard update or an asset finance record can no longer name another organisation's vendor; it answers 404, as for a vendor that does not exist (A-336, A-337).
- Changed: risk severity and likelihood must be 1–5, scores 0–100, and category and status must be one of the listed values (400 otherwise). A new risk always starts OPEN.

### 2026-10-01 — Six more API modules on TypeScript with a code-first contract ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 5)
- Changed (internal): the vendor, risk, supplier-scorecard, finance, billing and metered-billing routes and handlers are TypeScript, and each publishes its responses from shared schemas. The API answers exactly as before.
- Fixed (docs): the API reference no longer says vendor notes are discarded (they are stored), and it shows the metered-billing estimate as a read, as it always was.
- Found: the risk register and supplier scorecards accept unvalidated bodies, and a scorecard update or a finance record can name another organisation's vendor (A-335, A-336, A-337, open).

### 2026-10-01 — Exported costs are numbers; the landing's tests follow its server-rendered form ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 4 addendum)
- Fixed: a GDPR data export wrote work-order costs as text ("1250.50"). They are now numbers, as the API returns them.
- Tests: the landing page tests render the page's new streamed form, a prerender shell with the language-dependent content behind a loading skeleton. The frontend test and coverage gate is green again.

### 2026-10-01 — Work orders keep their schedule, costs and resolution notes ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 4, Q-55)
- Fixed: a work order's scheduled date, completed date, estimated cost, actual cost and resolution notes were accepted and silently discarded. They are now stored (migration 0107) and returned.
- Added: the work-order dialog has these fields: the schedule and estimate on create, and the outcome on edit. The list shows Schedule and Cost columns.
- Validation: a cost must be between 0 and 999,999,999,999.99; notes are at most 5,000 characters; a completed date cannot be before the scheduled date (400).
- Audit: the audit trail records the dates and costs, and the notes' length (not their text, A-190).

### 2026-10-01 — Phase 10 live E2E: request access → approve → invitation, reset, verify and passkeys proven in a browser; the whole suite green twice in production mode ([record](./records/2026-09-30-p10-13-e2e.md), P10-13)
- Tests: three TypeScript live specs (request access and the queue, public sign-in surface, verification and passkey refusals; 30 tests) and a TypeScript browser suite `automate/p10.browser.mts` (12 checks; two passkeys registered, used and one revoked on Chrome's WebAuthn virtual authenticator). `make test-browser` runs it; `make typecheck` checks it.
- Verified live (production mode): the first super admin's one-time password (value only inside the container), concurrent approvals create one tenant, the invitation works once, the reset code works once, register is absent, verification by number is minimal and budgeted.
- Fixed (tests only): the E2E harness's MFA state is per stack; network-security writes go to a disposable tenant; stale specs moved to the as-built contracts (A-281, A-293, P10-12, Q-49); deliberate failures use their own client address so back-to-back production runs do not trip the budgets.
- Found: the request budgets are sliding windows refreshed by every request, refused ones included (ADR-100) — reported, not changed.

### 2026-10-01 — Five API modules on TypeScript with a code-first contract; tenant status only through suspend/resume ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 3, ADR-112)
- Changed (internal): the warehouse, stock, roles, maintenance and QMS routes and handlers are TypeScript. Each request and answer is published from the same schemas the API enforces. The API answers exactly as before.
- Fixed (docs): the API reference now matches these modules: the warehouse fields it listed (city, province, capacity) never existed, and two roles routes were documented under a path nobody serves.
- Fixed: the startup permission check skipped converted route files; it now checks all 173 gates again.
- Changed: the tenant edit dialog no longer offers a status. A super admin suspends (with a reason) or resumes a tenant from the dialog instead (ADR-112).
- Security: `POST /roles/assign` returned the whole user record, credential hashes included (A-331, fixed).

### 2026-10-01 — Shared contracts: every request schema but two ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 2)
- Changed (internal): the request schemas of 40 of the 42 validator modules now live in `@callibrator/contracts`. The API accepts and refuses exactly what it did before. The network-security and tenant-flag schemas stay in the backend: one uses a server-only IP parser, the other the server's secret-setting policy.
- Fixed (docs): the API reference now documents `nameToShow` and `roleLevel` on `PATCH /roles/{id}`, which the API has accepted since F-19.

### 2026-10-01 — Shared contracts: nine more domains, one response envelope ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097 Am. 1)
- Changed (internal): the request schemas for warehouses, stock, maintenance, calibration records, users, roles, certificates, QMS and tenants now live in `@callibrator/contracts`, alongside vendors and devices. The API accepts and refuses exactly what it did before.
- Changed (internal): the response envelope has one definition, shared by the backend's types, the published API document (`openapi.json` unchanged byte for byte) and the frontend. Page sizes, QMS status lists and the tenant-logo name rule are defined there too.

### 2026-10-01 — Tenancy and identity controllers and routes are TypeScript; their API reference is generated from code ([record](./records/2026-10-01-p9-20-21-tenancy-identity.md), P9-20/P9-21)
- Internal: the tenant, lifecycle, hierarchy, backup, custom-domain, feature-flag, network-security, data-retention, admin, sign-in, user, permission, session, passkey, OIDC, SCIM and API-key controllers and routes are TypeScript. Every route, permission gate and middleware is the same as before.
- Changed (docs): those routes' API reference is now generated from code and checked against the routes' real permission gates; signed-in routes that act on the caller's own account say so.
- Fixed: the session list and detail now show when each session started; they showed nothing, and a meaningless "N/A" location (A-334).
- Fixed: "My sessions" now shows when each session started (A-339).
- Fixed: a platform operator can re-offboard an already offboarded tenant with `force`, as documented; it restarts the retention period, is audited, and only the super admin may do it (A-338).

### 2026-09-30 — The tenancy services are TypeScript; three tenant-edit defects found ([record](./records/2026-09-30-p9-13-tenancy.md), P9-13)
- Internal: the network-security, tenant-hierarchy, custom-domain, data-retention, tenant-lifecycle, tenant and tenant-logo services are now TypeScript. Nothing a user sees changes. Each was checked against its JavaScript version on the same inputs, and the three that decide who sees which tenant were also checked on a live PostgreSQL 18 database with two tenants.
- Found, not yet fixed:
  - A tenant edit that sends a status fails with a server error: the form's `ACTIVE` does not match the database's `active` (A-326).
  - Clearing a tenant's email is a server error, not a validation message (A-327).
  - The tenant creator field is never stored (A-328).
  - A top-level tenant's hierarchy view shows no sub-organizations (A-329).

### 2026-09-30 — ADR-095 follow-ups: certificate PDFs print Vietnamese, Polish, Greek and Cyrillic names; the backend refuses to boot if audit rows can be deleted; smaller memory limits ([record](./records/2026-09-30-adr095-followups.md), ADR-095 Am. 1)
- Fixed: a certificate PDF printed "Đặng", "Łukasz" and any non-Latin-1 name with `?`. The PDF now embeds Noto Sans (self-hosted, OFL, fetched only when a PDF is made). Latin Extended (incl. Vietnamese), Greek and Cyrillic print as written. Arabic, Hebrew, CJK and Thai still print `?`.
- Changed (**compliance**): the backend refuses to boot unless its database role cannot delete or truncate `audit_logs` and may update only the three masking columns.
- Changed (**operations**): backend memory limits cut to measured need. Helm default/staging and compose staging/vm: 1Gi (was 4Gi, staging 2Gi). Production: 1536Mi (was 4Gi). The measured peak was 337 MiB.
- Internal: live test suites that write audit rows now create and drop their own database instead of deleting audit rows. The browser smoke reads the PDF's embedded-font text, follows the verification token, and passed 7/7 live.

### 2026-09-30 — Public pages load less JavaScript; blog and news on the new public design ([record](./records/2026-09-30-P10-perf-blog.md), P10-13, ADR-098 Amendment 2)
- Changed: the landing, sign-in, verification, request-access, reset, invitation, blog and news pages no longer load the dashboard's providers (theme, tenant branding, session check, toasts), axios, or either full dictionary. First-load JavaScript (brotli): `/` 150.6 → 123.4 KB, `/verify/*` 155.4 → 117.9 KB (under its 120 KB budget), `/login` 161.2 → 150.2 KB, blog and news 237 → 119 KB.
- Changed: blog and news (index and article pages) use the public header, footer and dark design, in Indonesian by default with English on the language toggle. Titles say "Device Calibrator". Post bodies are still sanitized when shown (A-298).
- Changed: the dashboard's fonts are no longer preloaded on every page; on a first dashboard visit the text may briefly show in the fallback font.
- Added (guard): CI and `make verify` fail when a public page's first-load JavaScript exceeds `frontend/bundle-budget.json` (`frontend/scripts/bundle-budget.mjs`).

### 2026-09-30 — Migrations 0091–0106 verified on PostgreSQL 18; an upgrade blocker found ([record](./records/2026-09-30-live-pg18-migrations-a283.md))
- **Known issue (deploy blocker):** a database created before migration 0105 cannot start the current backend. At boot, the schema sync creates the new `api_key_id` indexes before 0105 has added that column, and the boot stops. Workaround until the Q-51 fix lands: run `npm run migrate` from a host checkout before starting the new image.
- Verified: with that workaround, migrations 0091–0106 apply on both a fresh database and one upgraded from `ce74932`. Every object was checked with psql and as the application role, and every migration from 0091 to 0105 goes down and back up cleanly.
- Tests: more live PostgreSQL suites now run as the application role (A-283). Three stale live suites were repaired.

### 2026-09-30 — CI has been running on GitHub all along; only the secret scan keeps it red ([record](./records/2026-09-30-p7-01-ci-gitleaks.md), P7-01)
- Found: GitHub Actions has run `ci` 10 times since 2026-09-24 and never been green. On `ce74932`, 7 of 8 jobs pass (backend tests at 100%, PostgreSQL 18 boot, frontend build, lint, typecheck, audit, deploy config, actionlint). Only `secret scan (gitleaks)` fails.
- Fixed: the gitleaks job failed on 3 false positives. They were a test file name and two sample-response JWT headers. The text was reworded at source, the 3 findings were fingerprinted with reasons, and two exact-literal allowlists were added: the `sk_test_` placeholder fallback and the temporary-password alphabet. No directory is allowlisted.
- Security: no real secret is in the repository history, so no credential needs rotating. The VM password could not be checked by value from this machine; the record has the one-line check for the owner.

### 2026-09-30 — Super-admin session revocation works; path ids cannot be overridden; the global 429 is the envelope ([record](./records/2026-09-30-correctness-batch.md), A-323, A-324, A-273, A-274, V-05…V-17, Q-52, Q-53, ADR-109 §6–7)
- Fixed: the platform super admin can revoke all of a user's sessions and revoke or delete another user's session. `revoke-all` answered 403 to everyone before (the role name was compared in the wrong spelling). The super admin is now recognised by one rule everywhere.
- Changed: on the data-retention, feature-flag and tenant-suspend routes, an id in the body (or query) that differs from the one in the path is a **400**. It used to override the path.
- Changed: when the author of an SOP tries to publish it, the answer is **403** with the reason (was 409). An already published or archived SOP is still 409.
- Changed: the global rate limit's 429 body is `{ success: false, status: 429, message, data: null, retryAfter }`, with `Retry-After` (was `{ status: "Error", message }`).
- Fixed: a vendor's notes are stored and returned (they were accepted and dropped). The vendor form has a **Notes** field and the list shows the note under the vendor's name. Notes are limited to 2,000 characters (a longer value is a 400). **Run migration 0106 on upgrade.**
- Added: revoking or deleting a user's sessions is recorded in the audit trail (who, whose sessions, how many), in the same transaction as the change.
- Fixed: a token revoked for brute force stays revoked on later failures (the limiter used to drop the flag on the 4th).
- Changed: `SIGNATURE_ALGORITHM` is removed. E-signatures are always RS256, and a deployment that sets another value refuses to start the e-signature service.
- Removed: the unused `allowApiKey` middleware, and the unused `includeDeleted` scope on 12 models (ApiKey keeps its scope).

### 2026-09-30 — Every board, ticket, CMS, feature-flag, warehouse and usage-alert change is now in the audit trail ([record](./records/2026-09-30-p6-11-audit-coverage.md), P6-11, ADR-109 §2)
- Added: kanban (projects, members, columns, cards, labels, sprints, relations), support tickets and comments, CMS posts and categories, per-tenant feature flags, warehouses and storage locations, and usage alerts each write an audit row in the same transaction as the change. If the change rolls back, so does its row. An API key is recorded as `system:api-key`.
- Changed: a feature-flag change by the platform operator appears in the platform's trail and in the affected tenant's trail (as tenant status changes already did).
- Fixed: deleting a warehouse soft-deletes it inside its transaction (it used to save outside it).
- Not audited, on purpose (owner to confirm): reading, hiding and deleting your own notifications; the RAG index rebuild; usage counters.
- Added (guard): a new service write with no audit row fails the build, unless it is listed with a reason.
- Added: GDPR consent grants and withdrawals, privacy-preference changes, data-subject and processing-restriction requests, SCIM group changes, new SOP documents, storage-setting changes, self-registration, SSO just-in-time accounts and a tenant's first (auto-created) subscription are now in the audit trail. Rows record what happened, never the personal data, free-text reasons or credentials.
- Changed: saving storage settings writes the configuration, the encrypted credentials and the audit row in one transaction.
- Verified: on PostgreSQL 18, as the application role, the row commits with its change and a forced rollback leaves neither.

### 2026-10-01 — Rate limits recover on schedule ([record](./records/2026-09-29-security-followups.md) § Amendment 5, ADR-100 Amendment 5)
- Fixed: request limits on the public sign-in, registration, password-reset, single sign-on and certificate-verification endpoints, and the per-endpoint API quotas, now reset at a fixed time. Before, every refused request restarted the wait, so a client that kept retrying — or a hospital behind one shared address — could stay blocked indefinitely. `Retry-After` now says exactly when the next request will be accepted.
- Fixed: a temporary account or address lock now reports when it really ends, and ends then.

### 2026-10-01 — No response carries a password hash or other credential (A-331) ([record](./records/2026-09-29-security-followups.md) § Amendment 4, ADR-100 Amendment 4)
- Security (high): `POST /roles/assign` returned the target user's password hash, MFA secrets, recovery codes, OTP and WebAuthn data. It now returns only the user's id, username, email, name, tenant, role, status and active flag.
- Security: users, API keys, sessions, webhooks, tenant signing keys, access requests and IoT devices no longer include their secret fields when converted to JSON, so a response that returns a whole record cannot leak them.
- Added: every route test now checks responses for credential fields and password hashes, and fails if it finds one.

### 2026-09-30 — Upgrade boot fixed: models no longer index a column a later migration adds ([record](./records/2026-09-29-security-followups.md) § Amendment 3, ADR-100 Amendment 3)
- Fixed (deploy blocker): upgrading an existing database failed at boot with `column "api_key_id" does not exist`. Boot builds model indexes before running migrations, and three models indexed the column that migration 0105 adds. The indexes are now created only by 0105. Fresh installs were not affected.
- Added: a unit-gate guard, `modelIndexColumns.am3`, that stops this class of defect from coming back. Also a live test, `upgradeBoot.am3.live`, that boots the current code against a database built by the previous release (ce74932). It passed there: 15 migrations applied, and schema-verify was OK.

### 2026-09-30 — Lists show which API key wrote a row ([record](./records/2026-09-29-security-followups.md) § Amendment 2, ADR-100 Amendment 2)
- Fixed: calibration records, stock adjustments and stock transfers written by an API key now show "API key: <name>" in the list, the calibration detail and the CSV exports, where they used to show "-". The key's secret hash is never sent. A revoked key still names its rows.

### 2026-09-30 — API keys can record stock and calibration work; IPv6 allowlists; geofence saves send your location ([record](./records/2026-09-29-security-followups.md) § Amendment 1, ADR-100 Amendment 1)
- Fixed: an API key can now record a stock adjustment, a transfer request, a stock item's opening quantity and a calibration record. The row names the key, not a user. Run migration **0105** on upgrade. Its down refuses while any key-written row exists.
- Changed: an API key can no longer approve, complete or cancel a transfer, perform an opname, void a calibration record or decide a workflow step (403). Those decisions need a person.
- Added: the IP allowlist accepts IPv6 addresses and ranges. An IPv4-mapped entry is stored as its IPv4 form.
- Changed: the Network Security page asks for your location when you save a geofence, so the server can check that the new geofence still includes you. Its write controls appear only to users with `network-security: write`.
- Security: every refused SSO start takes at least 400 ms (`SSO_REFUSAL_FLOOR_MS`), so response time does not reveal whether an organisation code exists.
- Verified: migrations 0096, 0098 and 0105 were run on a disposable PostgreSQL 18, both fresh and upgraded, and checked with psql as the application role. Do not run 0096's down on a database whose certificates have been printed: it regenerates every QR token.

### 2026-09-30 — What "complete" means for the Phases 0–10 stop, and the boards made true again ([record](./records/2026-09-30-board-hygiene-decisions.md), ADR-109)
- Decided (**working decisions, awaiting the owner's confirmation**): key rotation is rehearsed on a restored copy of the VM database after the closing deploy; all 15 unaudited mutating services get in-transaction audit rows; Phase 7 counts the kind cluster, and "wakes somebody" waits for an owner-supplied alert destination and log sink; Phase 8 is complete for this stop when every card is recorded as done, not triggered or blocked (P8-04 re-measure still owed); Phase 9 exits when all non-test source is TypeScript — the existing `.js` tests move to P9-26, and no new `.js` file is allowed.
- Decided (working): an API key performing a write is named in a new `api_key_id` column (exactly one actor per row, Q-51); vendor `notes` will be stored (Q-52); the global rate-limit 429 will use the standard error envelope (Q-53); an SOP's author publishing it gets 403 (V-13). New open question Q-54: single-administrator tenants and separation of duties.
- Changed (docs): stale task cards reconciled with their evidence; `TASKS/PROGRESS.md` Live Health restated from dated records — **the backend unit gate is red on today's shared tree** (other lanes' unfinished work; last green 2026-09-28), frontend 93.3% statements, E2E green twice on 2026-09-28, CI on GitHub unverified. Interim Phase 6 and Phase 7 summaries written.

### 2026-09-30 — The public pages are rebuilt: dark, Indonesian first, and every claim true ([index record](./records/2026-09-30-P10-frontend-as-built.md), ADR-098 Amendment 1)
- Removed: every fabricated testimonial, stock face, invented hospital, unsourced number, certification badge, price and "free trial" from the landing, sign-in and blog (P10-00).
- Changed: the landing is a fast server-rendered page in Indonesian (English one click away), showing the real product, what it supports and what it is not; WhatsApp and email buttons appear only when configured.
- Changed: sign-in asks for your email or username first and sends hospital SSO users straight to their identity provider; there is a *Forgot password?* link, a passkey button where the browser supports it, and every error is a plain sentence in your language.
- Added: `/request-access` (replaces `/register`, which now redirects), `/forgot-password`, `/invitation`. The verification page is restyled and not indexed by search engines.
- Fixed (**A-310**): sign-in, refresh and sign-out failed with a 500 when the backend ran with `FORCE_HTTPS=true` (Helm, compose prod/staging); the VM was not affected ([record](./records/2026-09-30-a310-forwarded-proto.md)).
- Open: the privacy notice must exist before `/request-access` is public; mobile Lighthouse Performance is 75–91 (target 90–95) on the test host.

### 2026-09-30 — Signed certificates are fixed at signing (v3); the seat limit is `limitSeats` (ADR-107) ([record](./records/2026-09-30-a303-tenant-profile.md))
- Changed (**compliance**): signing a certificate now records its issuer (name, address, contact), instrument and people as they stand at that moment; the certificate is printed from that record and its integrity hash is **`certificate-content-v3`**, which covers it. A later rename or move no longer changes an issued certificate. Certificates signed earlier keep their v2 hash and verify as before. Run migration **0103**.
- Fixed: the seat limit entered when creating a tenant was ignored (every tenant got 5); it is `limitSeats` now, and `POST /tenants/user-count` reports `limitSeats` and `remainingSlots` (null = unlimited) instead of `remainingSlots: NaN`. The tenant card shows the seat limit.

### 2026-09-30 — The API contract is generated from the validators and published behind sign-in ([record](./records/2026-09-29-P9-25-api-contract-foundation.md), ADR-103, P9-25)
- Changed: `/docs` is **Scalar**, not Swagger UI, and requires sign-in (tenant admin or super admin; an API key is refused) on every path, `/docs.json` included. A browser reaches it at `<frontend>/api/v1/docs` through the session proxy. `SWAGGER_ENABLED` keeps its meaning (off in production by default); no setting publishes the contract anonymously.
- Changed: the contract is `backend/openapi.json` (OpenAPI 3.1), generated by `npm run openapi:generate` and committed; `swagger.json` and `swagger:generate` are gone. The build and the image check it is current.
- Added: CI job `api-contract` and `make openapi` (in `verify`) — stale contract, new Spectral error, breaking change against `main` (oasdiff), stale frontend types; a guard fails a route with no document and an `x-permission` that differs from the route's gate.
- Added: frontend generated types and a typed client (`openapi-fetch` over the existing axios client); the vendor service uses it.
- Fixed: a `@swagger` block with broken YAML silently vanished from the contract (`PATCH /tenants/edit`); four JSDoc references named schemas that did not exist.
- Status: foundation only — vendor is the one module moved; the rest move with P9-20/P9-21.

### 2026-09-30 — Role fields saved; confirmations on allowlist, OIDC rotate and detach; paged risk and supplier lists; user photos uploaded ([record](./records/2026-09-30-f19-fixes.md), ADR-105, F-19)
- Fixed: a role's Display Name, Level and Active are now saved on create and edit.
  - A level is 1–8 and never above the caller's own.
  - A system role's level is fixed: changing it is refused with a 409 that explains why.
  - The roles list showed every role Inactive, and an edit re-activated an inactive role. Both fixed.
- Changed: `GET /roles` and `GET /roles/menus` answer a top-level `meta` instead of `pagination`.
- Added: confirmations before changing the IP allowlist, rotating an OIDC client secret (the old secret stops working at once), and detaching a tenant from its parent.
- Fixed: the risk register and supplier scorecards showed only the first 10 rows. They now page.
- Fixed: the tenant hierarchy page failed for every role but the super admin. It now shows the tree, and the platform-only actions are hidden from other roles.
- Fixed:
  - a failed backup list no longer says "No backups found";
  - calibration lists no longer share one loading and error flag;
  - a photo picked in the user dialogs is now uploaded.
- Fixed: kanban card details are a proper dialog (focus trap, Escape), and the board follows label, project and card-link changes live.
- Fixed: SSO copy failures are reported; custom-domain Verify says whether the domain verified; SOP offers acknowledgement only where the backend accepts it; stock and warehouse errors show inside the open dialog; the opname date shows today.
- Fixed: acknowledging an archived SOP is refused with a 409 that explains why (ADR-105 Amendment 1).
- Fixed: custom-domain verification now tells the tenant to publish a TXT record, the record it actually checks (it said CNAME).

### 2026-09-29 — Certificates completable from the UI with separation of duties; menus and buttons match what the API allows ([record](./records/2026-09-29-ui-correctness-fixes.md), ADR-101, ADR-102)
- Fixed: a certificate could not be completed from the UI — the table offered Approve on a draft (refused) and nothing after submission. It now offers Submit, then Approve, then E-Sign, and shows the server's explanation when a step is refused.
- Changed (**compliance**): the user who drafted or submitted a certificate can no longer approve it, directly or in an approval workflow; another user with approval rights must. Migration 0095 adds `certificates.submitted_by`.
- Fixed: the sidebar showed pages that answered "forbidden" and ignored per-user permission changes; pages showed write buttons by role name. Both now follow the same permission the API checks. Some admin roles lose menu entries that only ever failed.
- Added: Stock and Object Storage menu entries (migration 0097; flush the Redis `permissions:*` keys after it). Home now goes to the dashboard; `/dashboard/warehouse` redirects to `/dashboard/warehouses`.
- Fixed: backup Restore (type the backup's name) and Delete, and e-signature key-pair and workflow Delete, now ask first; a failed e-signature list shows the failure, not "none yet".
- Fixed: a global-search result opens its list filtered to that record; kanban cards can be moved between columns from the keyboard.
- Fixed (2026-09-30): 17 more screens stop offering write actions to roles the API refuses (quality, risk, workflows, asset finance, supplier scorecards, background jobs, predictive maintenance, usage alerts, blog, file delete, e-signature management, certificate OCR, feature flags, tenant lifecycle, data retention, OIDC clients, tenant hierarchy); the SCIM menu entry is shown only to the super admin, whom its API serves.
- Changed: the vendor create form no longer offers a rating (Q-37); edit keeps it.

### 2026-09-30 — Request access replaces self-registration; passwordless passkey sign-in; identifier-first SSO ([record](./records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108)
- Added: `POST /api/v1/access-requests`, a public request for access. It always answers 202 and emails nobody but the platform inbox (`ACCESS_REQUEST_NOTIFY_EMAIL`). `ACCESS_REQUEST_IP_PEPPER` is **required in production**: the server refuses to start without it.
- Added: the super admin's queue at `/dashboard/access-requests` (API `/api/v1/admin/access-requests`). Approving creates the tenant and its first administrator, and emails a single-use invitation valid for seven days. The administrator sets a password at `/invitation` (`POST /api/v1/auth/invitation/accept`).
- Added: passwordless passkey sign-in (`POST /api/v1/auth/passkey/options`, `/verify`). A user-verifying passkey counts as MFA, super admins included (Q-46, awaiting the owner). The login button ships with the login-page work.
- Added: `POST /api/v1/auth/login/discover` (identifier-first, by email domain) and `POST /api/v1/auth/sso/start` (the organisation code; the server picks SAML or OIDC). A tenant's SSO email domains are set by the super admin at `/api/v1/admin/tenants/:id/sso-domains`.
- Changed: **`POST /auth/register` is off in production** unless `SELF_REGISTRATION_ENABLED=true`, and then answers 404 like an absent route. Where it is enabled, a taken email or username gets the same 202 as a new address.
- Migrations **0099** (`access_requests`), **0100** (a unique passkey credential id; it refuses to run if two accounts share one) and **0101** (the Access Requests menu, SUPERADMIN only).
- Rejected, spam and expired access requests are deleted 12 months after their decision by the nightly retention job (Q-42).
- Added: **several passkeys per account** (a phone, a laptop, a security key; up to 10). You name them, rename them and remove them one at a time on the Passkeys page. Removing one needs your password, so the last one can never lock you out. Migration **0104** moves each existing passkey into the new `webauthn_credentials` table ([ADR-108 Amendment 1](./DECISIONS.md)).

### 2026-09-29 — Certificate verification token; sign-in network policy enforced; request budgets on public auth ([record](./records/2026-09-29-security-followups.md), ADR-100)
- Security: a certificate's QR now carries a random verification token. Looking up a bare certificate number (a typed number, or a QR printed before this change) shows only whether it is valid, revoked or expired, the issuer, the dates and the hashes. It no longer shows the device serial, the signer or the document. Run migration **0096** on upgrade.
- Security: a tenant's IP allowlist is enforced at every sign-in and token refresh. The geofence is enforced at password, MFA and passkey sign-in, using the device's reported location. A refusal is a 403 with `code: NETWORK_POLICY` or `LOCATION_REQUIRED`. A platform operator is never refused by a tenant's policy.
- Changed: tenant administrators can set their own tenant's allowlist and geofence (migration **0098**). A change that would lock out the person making it is refused with 409 `SELF_LOCKOUT`.
- Security: login, register, send-otp, reset-password, the SSO starts and the MFA sign-in have per-address request budgets that count successes too. Send-otp is also limited per mailed-to address. A 429 carries `Retry-After`. Per-IP failure counting is now on by default in production (`AUTH_RATE_LIMIT_BY_IP=false` turns it off).
- Security: the SSO start answers every unavailable organisation code with the same 404. Activation links are built from `FRONTEND_URL`/`HOST_URL`, never from the request's `Origin`.
- Fixed: a validation error raised inside a controller now returns the same 400 body as the request validator, with the field list, instead of `"[object Object]"`.
- Fixed: audited writes made with an API key are recorded as `system:api-key`, not as a user. `GET /dashboard/metrics` now requires `home: read`. Offboarding and Stripe plan changes are audited under PLATFORM and the tenant.

### 2026-09-30 — The Helm charts install on a kind cluster; seven chart defects fixed ([record](./records/2026-09-30-p7-06-helm-kind-cluster.md), ADR-106, P7-06)
- Fixed: a `helm upgrade` that changed only backend configuration did not restart the backend (the config checksum was always empty).
- Fixed: the chart rendered no `FRONTEND_URL`, `OIDC_ISSUER` or `PUBLIC_BASE_URL`; the OIDC discovery document advertised `http://localhost:5000`. All three now derive from `ingress.host`.
- Added: `backend.env.ALLOW_SEEDING`, the first-boot seeding toggle, which a Helm install could not set; NOTES warns while it is on.
- Added: `/health` on the ingress (exact path, to the backend), as the compose nginx publishes it.
- Changed: explicit 5 s probe timeouts; a frontend startup probe; the backend startup budget is 12 min (above the 10 min migration-lock timeout). Chart 0.2.0.
- Found (A-310, open): browser sign-in fails when `FORCE_HTTPS=true` — the Next auth handlers do not send `X-Forwarded-Proto` to the backend. Affects the Helm defaults and the compose prod overlay.
- Status: proven on one local kind cluster only; **not** on a production cluster.

### 2026-09-30 — Tenant address and contact are stored and printed on certificates (A-303) ([record](./records/2026-09-30-a303-tenant-profile.md))
- Fixed: a tenant's description, phone, address, city, province, postcode, country and website were accepted and silently discarded. They are stored now (migration **0102**, run it on upgrade).
- Added: certificates print the issuing laboratory's address and contact under its name (ISO/IEC 17025 7.8.2). The integrity hashes are unchanged.
- Changed: a website must be an `http://` or `https://` address, and a phone number digits with the usual separators (400 otherwise). The tenant edit form no longer shows Max Users; the edit API ignores `maxUsers` (it never stored it).

### 2026-09-30 — Stored-XSS hardening; API-key scopes that work; real menu-group selection ([record](./records/2026-09-30-xss-apikey-menugroups.md), A-298–A-302)
- Security: blog and news bodies no longer accept `data:` links or images. Every body is sanitized again when it is served and when it is rendered, so content saved before the fix is safe without a migration.
- Security: a ticket's description is sanitized when it is shown. It was rendered raw, including to the platform's responders.
- Fixed: the Create API Key dialog offers the real resources (menu slugs, read or write). Before, nearly every scope it offered was refused.
- Fixed: on Menu Groups, "Select All" works, and bulk Assign and Revoke act on the groups you select, not on every assigned group. A bulk revoke asks first.
- Changed: the calibration scheduler's Run button appears only to users who may run it. Menu-group create, edit and delete follow the effective super-admin permission, not a role name.
- Fixed: clearing a searchable dropdown no longer opens it.

### 2026-09-30 — A session survives its access token; accessible tenant brand colours; accessibility checks in the browser suite ([record](./records/2026-09-29-feauto-a11y-f05-brand.md), ADR-074 Am. 1, ADR-090 Am. 1)
- Fixed: after the access token expired (15 minutes by default), opening or reloading any dashboard page signed the user out. The page now stays open and the session renews silently.
- Fixed: users who sign in with MFA, which includes every platform operator, and impersonated sessions could not renew at all, and were signed out at the first expiry.
- Fixed: when a session cannot be renewed, sign-out now removes the refresh cookie too.
- Changed: a tenant's brand colour is shown in a shade that stays readable (WCAG AA) in each theme. The tenant form shows the shade each theme will use. A colour that is already readable is used exactly as chosen.
- Changed: with "reduce motion" set in the operating system, entrance animations and transitions no longer run anywhere. Spinners still turn.
- Added: `make test-browser` also runs an accessibility pass (`automate/a11y.browser.js`): axe on key pages in both themes, the focus behaviour of create dialogs, 200% zoom, reduced motion, and a tenant brand colour.

### 2026-09-29 — One request schema for the backend and the frontend: `packages/contracts` ([record](./records/2026-09-29-p9-22-contracts.md), ADR-097)
- Added: the `@callibrator/contracts` workspace. The vendor and calibration-device request schemas, and the shared field schemas, live there; the backend validates with them, and the frontend types its requests from them, so a contract change breaks the frontend's compile.
- Changed: the vendor form no longer sends `rating` when **creating** a vendor. The API has always discarded it there (Q-37), so nothing stored changes. Editing still sets the rating.
- Build: both Docker images copy `packages/contracts`, and the backend binary carries a compiled copy (`build-dist`).

### 2026-09-30 — Database migrations are TypeScript; their recorded names are unchanged ([record](./records/2026-09-30-p9-23-migrations.md), P9-23, ADR-087)
- Changed (**internal, no operator action**): all 63 migrations 0001–0090 are now `.ts`. Each keeps its `schema_migrations` name, which still ends in `.js`. An existing database finds nothing pending, and a fresh one builds an identical schema: proven on PostgreSQL 18 with `pg_dump --schema-only` and the grants.
- Added: `manifestNames.p923.test.ts` fails if any historical migration name is changed, reordered or unregistered, or if a migration exists as both `.js` and `.ts`.

### 2026-09-30 — Frontend coverage past 70%; screens fixed that showed wrong values or looked empty on failure ([record](./records/2026-09-30-frontend-coverage-70.md), ADR-067 Am. 1, F-19)
- Fixed (**data loss**): saving the tenant SSO settings after they failed to load disabled SSO and blanked its IdP fields. Save now waits for a successful load.
- Fixed: these screens showed wrong or blank values because they read fields the API never sends:
  - GDPR consents;
  - tenant lifecycle (offboarded tenants could not be restored, and a refused action closed the dialog);
  - OIDC endpoints;
  - custom-domain DNS records and status colours;
  - feature flags (every flag showed Enabled);
  - cross-tenant roles;
  - SOP documents (the list was always empty);
  - metered-billing invoices;
  - batch-job failure reasons;
  - user first and last name on edit.
- Fixed: about 30 screens showed "nothing here" when the list failed to load. They now show the error.
- Fixed: kanban card actions, sprint changes and moves failed silently, and several dialogs had accessibility defects.
- Changed (**gate**): the frontend coverage gate is 90 / 81 / 86 / 91 (was 41 / 35 / 34 / 41); measured 90.91 / 81.62 / 86.94 / 91.61.

### 2026-09-29 — A tenant cannot point the server at its own network (A-176); a refused CORS origin is 403 ([record](./records/2026-09-29-a176-ssrf.md), ADR-104)
- Fixed (**security**): the OIDC authority and the AI base URL are tenant settings that the **server** fetches. Before this fix, a tenant admin could aim them at `169.254.169.254` or at internal services, and redirects were followed. Every such call now checks the URL and pins the DNS answer at connect time. It follows no redirect, times out, and caps the response at 2 MiB. The IdP's published JWKS and token endpoints get the same checks, and so does a tenant S3 endpoint.
- Changed (**security, may need operator action**): `PATCH /tenants/settings` refuses an internal `oidc_authority` or `ai_base_url` with a 400 that names the key. In production it also refuses one that is not https. An IdP or AI endpoint on a private network no longer works in production. For development, name its host in the new `SSRF_DEV_ALLOW_HOSTS`, which production ignores.
- Fixed (**security**, A-306): the SSRF check read `http://[::ffff:169.254.169.254]/`, which URL parsing rewrites to hex, as a public address. This affected webhooks and S3 endpoints too.
- Fixed: in production, a CORS preflight from a disallowed origin returned **500**. It is now **403**, still with no `Access-Control-Allow-Origin`.
- Changed: every AI vendor call has a 60 s timeout. Before, it had none.
- Fixed (**security**, A-307, 2026-09-30, ADR-104 Amendment 1): webhook delivery connects to the address it checked. A DNS answer that changes between the check and the connection (rebinding) no longer sends the signed POST inside the network. Deliveries, signatures, retries and timeouts are otherwise unchanged. The request now identifies itself as `axios/<version>`, not `node`.

### 2026-09-29 — DAST: a live security probe of a local production-mode stack ([record](./records/2026-09-29-dast-live-probe.md))
- Verified (**security**, no code change): the probe found no new vulnerability. Clean: JWT tampering, login and password-check budgets, the forgot-password oracle, two-tenant isolation (404s), mass assignment, the authorization matrix and API-key scopes, input handling, open redirect, and production headers.
- It reconfirmed the SSRF surface on A-176 (fixed above), a 500 on a refused CORS preflight (fixed above), and a masked 400 on a tenant admin's SUPER_ADMIN create. ADR-100's `isValidationFailure` had already fixed that 400 in the working tree, and it is now pinned by a test.

### 2026-09-29 — The first super admin has a one-time password, visible only inside the container ([record](./records/2026-09-29-superadmin-bootstrap-otp.md), ADR-099)
- Changed (**security, operator action required**): the seeded super admin `sys@mail.com` no longer has the public password `123123`. The seed creates it only when no super admin exists, with a random one-time password written **only** to `/app/.bootstrap/superadmin-password` inside the backend container. Read it with `docker exec <backend> cat /app/.bootstrap/superadmin-password` (`deploy/README.md` § First Boot).
- Changed (**security**): a deployment whose super admin still has `123123` is moved to a one-time password at the first boot of this version. Read the file after deploying.
- Fixed (**security**): re-running `GET /migration/seeding` reset the super admin's password to `123123`. The seed no longer touches an existing password.
- Added: the first sign-in with a one-time password returns a short-lived password-change token instead of a session. The sign-in page asks for a new password at once, then signs in normally (MFA enrolment follows). New public endpoint `POST /api/v1/auth/first-sign-in/password`. Migration `0094` (`users.password_one_time`).
- Added: `./backend rotate-bootstrap-password --user … --requested-by … --ticket …` (container) / `npm run bootstrap:rotate` (checkout) issues a new one-time password, audited.
- Changed (**security**, 2026-09-30, ADR-099 Amendment 1): a password an administrator sets for another user (create or reset) is now one-time as well. Its first sign-in asks for a new password and opens no session; using it again fails. The reset's temporary password is still shown once to the administrator.
- Changed: the demo-data seeder refuses to run when `NODE_ENV=production`, whatever `SEED_DEMO` says (the demo users share a known password).
- Changed (**tests**): the live E2E suite and the browser automation need `E2E_OPERATOR_PASSWORD`, plus `E2E_BOOTSTRAP_PASSWORD` on a fresh stack. There is no default.

### 2026-09-29 — Multipart bodies sanitized like JSON (A-296) ([record](./records/2026-09-29-multipart-sanitizer.md))
- Fixed (**security**): fields of a `multipart/form-data` request (every upload route: tenant create/edit/logo, user avatar, attachments, CMS media, bulk import, AI OCR) were stored unescaped, because the global sanitizer ran before multer parsed them. They now get exactly the escaping a JSON body gets.
- Removed: the never-mounted `errorLog` access logger (it would only have duplicated the 4xx/5xx lines `accessLog` already writes).

### 2026-09-29 — Phase 10 planned: public pages revamp; Phase 11 on hold ([record](./records/2026-09-29-P10-00-phase-10-11-planning.md), ADR-098)
- Planned (documents only, nothing built): the landing, sign-in, request-access, forgot/reset and certificate-verification pages are to be rebuilt dark and bilingual (Indonesian first), with every fabricated testimonial, customer, number and certification badge removed first (P10-00).
- Recorded (**security**): the activation link built from request headers (A-289), register enumeration (A-290), uncounted OTP/registration successes (A-291), SSO tenant-code disclosure (A-292), certificate-number enumeration (A-293).

### 2026-09-29 — Emails carry the product's own logo, colours and copy ([record](./records/2026-09-29-email-templates-branding.md))
- Changed: the activation, password-reset OTP, account and notification emails use the Device Calibrator logo once, in the header, and the brand palette (navy `#001250`, teal `#00DAB4`).
- Fixed: the emails still carried another product's boilerplate text ("students", "$1000++ jobs", a fictional street address). They now say, in Indonesian and English, only what the system does: activation link valid 24 hours, OTP valid 5 minutes.

### 2026-09-29 — Security fixes A-275 to A-282 ([record](./records/2026-09-29-security-fixes-a275-a282.md), ADR-094)
- Fixed (**security**): an OIDC authorization request could be approved by a user of any tenant. Only a user of the client's own tenant may now read or decide it, and another tenant's request answers 404, like one that does not exist.
- Fixed (**security**): a Stripe payment re-activated a tenant the platform operator had suspended, or had offboarded. A payment now lifts only a dunning suspension, and every billing status decision is audited.
- Fixed: a ticket assignee, kanban member, card assignee or risk assignee from another tenant was accepted. It is now refused with 404.
- Fixed: SCIM user writes, API-key create and revoke, e-signature key create and delete, vendor, risk, scorecard and asset-finance writes, and the tenant suspend/resume/grace-period/cancel transitions now write their audit row inside the transaction.
- Changed: cancelling an offboarding that does not exist is **409** (was 400). Suspending or resuming an offboarded tenant is 409.
- Added: `/network-security/tenants/:tenantId/{ip-allowlist,geofence}` and `/oidc/tenants/:tenantId/clients…` let the platform operator act on a named tenant.
- Changed: `POST /ai/query` and `/ai/ocr` answer **409** when no AI provider is configured (was 500), and **502** when the provider fails.

### 2026-09-29 — The audit trail is append-only in the database; certificate PDFs are rendered by the frontend ([record](./records/2026-09-29-adr095-audit-append-only-pdf-frontend.md), ADR-095)
- Added: migration `0091`. `audit_logs` refuses DELETE, TRUNCATE and every UPDATE except GDPR masking, for every database role, and the application role lost UPDATE/DELETE/TRUNCATE on it. The boot schema check requires the two triggers.
- Changed (**breaking API**): the backend renders no certificate PDF. `POST /certificates/:id/pdf` is removed. `GET /certificates/:id/pdf` serves only a PDF stored before this change. The new `GET /certificates/:id/document` returns the printed fields, the verification URL and the integrity hashes. The public verification endpoint adds `integrity` (the v2 hash) and, for a signed certificate, `document`.
- Changed: the dashboard and the public verification page render the certificate PDF in the browser (jsPDF), with the verification QR and the `certificate-content-v2` hash, which binds every printed certificate field. The v1 hash on earlier PDFs still verifies.
- Removed: Chromium, its fonts and `PUPPETEER_EXECUTABLE_PATH` from the backend image and the deploy manifests; `puppeteer` is a devDependency.
- Fixed: a system role could be soft-deleted through `Role#softDelete` (Q-35). The key-rotation rehearsal covers users' TOTP seeds (Q-36).

### 2026-09-29 — P9-11: request validation is Zod, and Joi is removed ([record](./records/2026-09-29-p9-11-validators-zod.md), ADR-093)
- Changed: every request validator moved from Joi to Zod, and the `joi` package is gone. A validation 400 keeps its status, envelope and top-level message, and `details` still appears only outside production. The **wording inside `details` changed** (ADR-093 lists every string).
- Changed: metered billing's validation 400 has the common envelope. In production it now says "Validation Error" instead of the generic error.
- Changed: ids in braces or without hyphens are refused. Emails are no longer checked against the IANA top-level-domain list.
- Found: a validation failure thrown in a controller loses its field list on the wire (A-272). Three controllers let a body `tenantId` win over the path (A-273).

### 2026-09-29 — The code conventions describe the code as it is ([record](./records/2026-09-29-code-conventions-update.md))
- Changed (docs): the backend, TypeScript, testing, tooling, review-checklist and frontend standards, and the Commands/Code Style parts of `CLAUDE.md` and `AGENTS.md`, now state the as-built rules — mixed JavaScript/TypeScript run through tsx, Zod validation through `validate()`, raw SQL through `sql()` with a bound tenant predicate, configuration through `config/env.ts`, two-tenant tests on the real hooks, the page CSP and the accessibility rules — and correct statements that said there was no route guard, no CI, no hook and no committed lockfile.
- Found: most live PostgreSQL suites do not run as the application role (A-283); the backend lint gate covers `src/` only (A-284).

### 2026-10-01 — The backend image builds without a fragile download, and from the tree you name ([record](./records/2026-10-01-a325-a332-image-build-robustness.md), A-325, A-332)
- Fixed: the Node binary the backend image is packaged around is downloaded once, with retries, checked against a pinned checksum, and reused; a failed or tampered download stops the build with a clear message instead of an opaque failure (A-325).
- Fixed: the compose files declare where an image is built from in one place (`BUILD_CONTEXT`), so a development overlay can no longer silently build from a different copy of the code (A-332).

### 2026-09-30 — Editing a tenant works again; a head organisation sees its sub-organisations ([record](./records/2026-09-30-a326-a329-tenant-edit-hierarchy.md), A-326 … A-329, ADR-112)
- Fixed: saving a tenant's details no longer fails with a server error. The status is changed only by suspending or resuming the tenant, and the edit says so when asked to change it (A-326).
- Fixed: clearing a tenant's email is refused with a clear message instead of a server error (A-327).
- Fixed: a head organisation's tree and its list of descendants now show its sub-organisations, and one branch's descendants no longer include a look-alike branch (A-329).
- Changed: creating a tenant no longer passes a creator field the database never stored; the creator is recorded in the audit log, as before (A-328).

### 2026-09-30 — P9-12: the sign-in and user code was run end to end in a built image ([record](./records/2026-09-30-p9-12-image-baseline.md))
- Checked: the live test suite against an image of the converted code; no failure traces to the sign-in, user, key, single sign-on or provisioning code.
- Fixed (tests): two end-to-end tests now replace a one-time password the way sign-in has required since P10-16.
- Found: building the backend image depends on downloading a Node binary during the build (A-325).

### 2026-09-30 — P9-16: workflow, quality management, risk, supplier scorecard and vendor code is TypeScript ([record](./records/2026-09-30-p9-16-quality-services.md))
- Changed: those five services are TypeScript, with no change to what they do.
- Found (not fixed): vendor search is case-sensitive (A-330).

### 2026-09-30 — P9-15, P9-17: warehouse, stock, billing, finance and payments code is TypeScript ([record](./records/2026-09-30-p9-15-17-warehouse-commercial-services.md))
- Changed: the warehouse, stock, billing, finance, Stripe webhook and metered-billing services are TypeScript, with no change to what they do.
- Found (not fixed): A-319 … A-322.

### 2026-09-30 — A backend module that cannot load now fails the gate ([record](./records/2026-09-30-p9-load-gate.md), ADR-087 Amendment 15)
- Added: `npm run load:check` requires every backend module the way production loads it (the built tree under node, the source under tsx), in `make verify` and a new CI job; a lint rule forbids the export shape that crashed the boot.

### 2026-09-30 — Ticket descriptions are cleaned when saved ([record](./records/2026-09-30-a318-ticket-description-sanitize.md), A-318)
- Fixed: a ticket description keeps its formatting but loses scripts, event handlers and unsafe links when it is stored, not only when the page shows it.

### 2026-09-30 — API keys can be scoped to calibration, certificates, maintenance, notifications and reports ([record](./records/2026-09-30-a311-api-key-scopes.md), A-311)
- Fixed: the API-key scope list is one shared list that covers every resource a route checks; five were missing, so no key could reach those routes. A guard test now fails if a route checks a resource no key can be given.

### 2026-09-30 — API keys can edit users; the edit response reports the active flag ([record](./records/2026-09-30-a282-user-routes-a295.md), A-282, A-295)
- Fixed: user changes made with an API key are recorded as the key (`system:api-key`), so they no longer fail on the database (A-282).
- Fixed: editing a user answers with its `is_active` flag again (A-295; the stored flag was never changed).

### 2026-09-30 — P9-12: sign-in, users, API keys, single sign-on, SCIM and OpenID Connect are TypeScript ([record](./records/2026-09-30-p9-12-batches-2-3.md), ADR-087 Amendment 14)
- Changed: the authentication, user administration, API key, SAML/OIDC single sign-on, SCIM provisioning and OpenID Connect provider services are TypeScript, with no change to what they do.
- Found (not fixed): editing a user writes an empty active flag on every edit (A-295).

### 2026-09-29 — Roles and menus: system roles are protected, and the fields a request sends are stored ([record](./records/2026-09-29-a285-a294-role-menu-attributes.md), A-285 … A-287, A-294)
- Fixed: deleting a system role deactivates it instead of destroying it, and a system role can no longer be given status "deleted" (A-285).
- Fixed: a role created through the API keeps the privilege level it was created with (it was always level 1, A-294). The system flag (A-286) and a menu's order and active flag (A-287) are stored.

### 2026-09-29 — P9-19 round 1: ten middlewares are TypeScript ([record](./records/2026-09-29-p9-19-middlewares-round1.md), ADR-087)
- Changed: the 404 handler, uuid validation, the request-timeout answer, the XSS sanitizer, the access log, the folder bootstrap, the global error handler, the metrics token gate, role-based access (`rbac`) and the Part 11 platform-authoring guard are TypeScript. What they do is unchanged, shown by 11,906 identity checks and a live check.
- Added: a test pinning that `rbac()` admits anyone at or above the lowest listed role's level.

### 2026-09-29 — P9-12 batch 1: token signing, sessions, passkeys, user permissions and roles are TypeScript ([record](./records/2026-09-29-p9-12-batch1-identity-leaves.md), ADR-087 Amendment 13)
- Changed: JWT signing and verification, refresh-token sessions and their liveness check, passkeys, per-user permission overrides, and roles and menus are TypeScript, with no change to what they do.
- Found (not fixed): deleting a system role destroys it instead of deactivating it (A-285); two role/menu fields a request can send are silently ignored (A-286, A-287).

### 2026-09-29 — P9-07: raw SQL goes through a bind-only helper ([record](./records/2026-09-29-p9-07-sql-helper.md), ADR-087 Amendment 12)
- Added: `sql()`, the one way converted code runs raw SQL. It takes bound values only and refuses the placeholder mistake that once read all metered usage as zero. A raw statement on tenant data must bind its tenant predicate (enforced by lint and by the D-05 test); verified against live PostgreSQL 18 as the application role.

### 2026-09-29 — P9-10 done: every model and the models barrel are TypeScript ([record](./records/2026-09-29-p9-10-done-barrel.md), ADR-087 Amendment 11)
- Changed: sessions, users, tenants, roles, the audit log, API keys, tenant keys and settings, the tenant hierarchy, menus and permissions, and the models barrel are TypeScript — all 71 models — with no change to what any code sees; verified against live PostgreSQL 18 as the application role and by the full end-to-end baseline against the rebuilt image.
- Found (for decision): the audit log is append-only only by the application, not in the database; a system role can be soft-deleted through the model method.

### 2026-09-29 — P9-10: content, ticket, GDPR and platform models are TypeScript ([record](./records/2026-09-29-p9-10-models-batches-7-8.md), ADR-087 Amendment 10)
- Changed: the blog/news CMS, support tickets, GDPR consent and data-subject requests, custom domains, SCIM groups, webhooks and their deliveries, and tenant backups are TypeScript models, with no change to what they define or do; verified against live PostgreSQL 18 as the application role. 59 of 71 models are converted.

### 2026-09-29 — P9-10: calibration, certificate and signature models are TypeScript ([record](./records/2026-09-29-p9-10-models-batches-5-6.md), ADR-087 Amendment 9)
- Changed: the calibration device, calibration record, certificate, IoT reading, attachment and document-chunk models and the four electronic-signature models are TypeScript, with no change to what they define or do; verified against live PostgreSQL 18 as the application role, including the append-only calibration records and the retired-device rule. 46 of 71 models are converted.

### 2026-09-29 — P9-10: workflow, quality, supplier, billing, usage and notification models are TypeScript ([record](./records/2026-09-29-p9-10-models-batches-3-4.md), ADR-087 Amendment 8)
- Changed: 21 more models (approval workflows, CAPA / non-conformance / SOP, vendors, risks, supplier scorecards, invoices and subscriptions, plan quotas and usage, notifications, batch jobs, maintenance work orders, asset finance) are TypeScript, with no change to what they define; verified against live PostgreSQL 18 as the application role. 36 of 71 models are converted.

### 2026-09-29 — P9-10: Kanban and inventory models are TypeScript ([record](./records/2026-09-29-p9-10-models-kanban-inventory.md), ADR-087 Amendment 7)
- Changed: the nine Kanban models and the six inventory models (warehouses, storage locations, stock and its transfers, adjustments and counts) are TypeScript, with no change to what they define; verified against live PostgreSQL 18 as the application role.
- Changed: the documented model-typing pattern is amended — the one first proposed does not compile for models that refer to each other.

### 2026-09-29 — Phase 9 round 6: job context, migration lock, configuration accessors ([record](./records/2026-09-29-p9-round6-jobcontext-config.md), ADR-087 Amendment 6)
- Changed: the background-job tenant context, the migration lock, the authorization-wiring check, the public-base-URL and scheduler-switch helpers, the JSON-shape validator and the IoT validator are TypeScript, with no behaviour change; the job context was verified on live PostgreSQL 18 as the application role.
- Changed: converted code reads the environment only through `src/config/env.ts`; an empty variable still means "use the default" (P9-06 part 1). The fail-fast environment schema (part 2) is not yet in.

### 2026-09-29 — Phase 9: leaves, constants done, baseline on a converted image ([record](./records/2026-09-29-p9-leaves-baseline-image.md), ADR-087 Amendment 5)
- Changed: the response helpers, upload, file validation, controller wrapper, OTP and SSRF utilities and the route-gate exemptions are TypeScript, with no behaviour change; `constants/` is entirely TypeScript.
- Verified: the full live E2E baseline (53 specs) passes unchanged against an image built from the partly converted backend.

### ADR-088 — authorization matrix, records, docs ([record](./records/2026-09-27-az-authz-matrix-and-records.md))
- **`GET /quota` now needs `billing: read`** — it answered every role. A custom role without `billing` loses it.
- RAG answers are drawn only from SOP documents, enforced in the retrieval SQL.
- Documentation corrected where it contradicted the code: health endpoints, rate limits, Swagger paths, the two-tenant fixture, webhooks and search.

### 2026-09-28 — Phase 9 guard sweep and tenantScope ([record](./records/2026-09-28-p9-guard-sweep-tenantscope.md), ADR-087 Amendment 4)
- Fixed: 20 source-scanning guard suites ignored `.ts` files, so every conversion silently left them; they now scan `.ts` and were each proved to fail on a planted `.ts` violation.
- Changed: the tenant-isolation engine (`utils/tenantScope.util`) is TypeScript, with no behaviour change; verified against live PostgreSQL 18 as the application role.

### 2026-09-28 — Phase 9 P9-00, P9-02, P9-02a, P9-03a ([record](./records/2026-09-28-p9-helper-lint-baseline-coverage.md), [baseline](./records/P9-00.md), ADR-092)
- Added: the Phase 9 behaviour baseline — 53 live E2E specs, all passing twice on the pre-conversion commit `35ebd76`.
- Changed: backend lint has 0 errors (was 1,050; formatting only, proved AST-identical) and the ratchet baseline is 0, so any new lint error fails CI and the pre-push hook.
- Changed: one ESLint config (`backend/.eslintrc.js` deleted); global ignores actually global; `backend/.prettierrc` is the backend's Prettier config.
- Changed: the `istanbul ignore` guard scans `.ts` files too; docs no longer show `node src/…` commands that cannot run since ADR-087.

### 2026-09-28 — Phase 9 P9-05a ([record](./records/2026-09-28-p9-05a-logger-tenant-context.md), ADR-087 Amendment 2)
- Changed: the logger (`activityLog.middleware`), the tenant context (`tenantContext.middleware`), `dbReady` and `circuitBreaker` are TypeScript, with no behaviour change; a live two-tenant check on PostgreSQL 18 as the application role passed.
- Changed: new backend test files are TypeScript (the ratchet counts tests).

### 2026-09-28 — Phase 9 ratchet and constants ([record](./records/2026-09-28-p9-ratchet-constants-paths.md), ADR-087 Amendment 1)
- Added: `npm run ratchet` — any new backend `.js` file (tests included) fails `make verify`, CI and the pre-push hook.
- Fixed: jest transformed TypeScript with Babel 7 core + Babel 8 presets, which left explicit type arguments in the output; `backend/jest.transform.js` uses Babel 8 throughout.
- Changed: every `constants/` module except `routeGateExemptions`, and `utils/storagePath` / `utils/appPath`, are TypeScript, with no behaviour change; a role without a `ROLE_LEVELS` entry no longer compiles.

### 2026-09-28 — Phase 8: migration lock and load baseline ([record](./records/2026-09-28-p8-scale-cards.md), ADR-086)
- Fixed: two backend replicas starting together no longer run `db.sync()` and the migrations twice (one used to crash). The schema step holds a PostgreSQL advisory lock; the other replica waits, up to `MIGRATION_LOCK_TIMEOUT_MS` (default 10 min).
- Changed: `npm run migrate` / `migrate:undo` take the same lock and wait for a booting replica.
- Added: `scripts/load/` — the P8-07 volume seed and k6 baseline, with per-response cross-tenant checks.
- Measured: no cross-tenant leakage under concurrency; the list p95 target is missed above low concurrency, and PostgreSQL is the ceiling.

### 2026-09-28 — Phase 9 toolchain and first conversions ([record](./records/2026-09-28-p9-toolchain-and-first-leaves.md), ADR-087)
- Added: `backend/tsconfig.json` (strict + ADR-038 flags), `npm run typecheck` (TypeScript 7) in CI, `make typecheck` and the pre-push hook.
- Added: `npm run build:dist` — the binary is built from `dist/` (JavaScript copied, TypeScript compiled); a `.ts` file importing `.js` fails the build.
- Added: jest runs `.ts` sources and tests (babel-jest); ESLint lints `.ts` with typescript-eslint strict type-checked rules.
- Added: `backend/src/types/` for shared types, with a lint rule against shared shapes declared elsewhere.
- Changed: `utils/packaged.util` and eight `constants/` modules are TypeScript, with no behaviour change.
- Changed: backend source runs through tsx (`npm start`, `dev`, the migrate/swagger/keys scripts, `make seed-demo`, CI boots); plain `node src/…` no longer works. `nodemon` removed.

### 2026-09-28 — P7-01 / P7-02 / P7-03 ([record](./records/2026-09-28-p7-01-02-03.md), ADR-082)
- Fixed: `npm run migrate` / `migrate:status` now exit (M-13); they hung on the open database pool.
- Fixed (CI, never yet run on GitHub): `boot-and-migrate` installs dev tools (`tsx`); backend coverage no longer depends on the local `.env`.
- Added: a retention sweep that runs out of budget, or a quarantine sweep that stops at its entry limit, raises a `warning` alert (`job.<name>.incomplete`), then `resolved`.
- Added: the backend states its alert route at boot (webhook host / email count, or "NONE configured").
- Changed: Vector ships alerts through their own Loki sink; the template has shipped real logs locally, with redaction verified in Loki.

### 2026-09-28 — P6-02 / A-20 ([record](./records/2026-09-28-p6-02-e2e-green.md), ADR-077)
- The live E2E suite passes in one uninterrupted run (twice): 392 tests, no 429.
- Fixed: sign-in answers now carry the refresh token, so sessions can be renewed (password, MFA, SSO, impersonation).
- Fixed: GDPR export (missing `/app/exports`, archiver 8 API) and tenant backup (500 on every create).
- Fixed: a new platform operator could not enrol MFA in the browser (access-denied modal loop).
- Fixed: table cells given as JSX rendered "[object Object]" (device list and others).
- Fixed: vendor approve/reject (500), e-signature key delete, calibration-record correction with no results, user-permission delete on seeded menu groups.
- `make test-browser` runs `automate/smoke.browser.js` (five checks, puppeteer-core); the 71-test Playwright claim is withdrawn.

### Phase 6 open cards — 2026-09-28 ([record](./records/2026-09-28-phase6-open-cards.md), ADR-085)

- **Fixed:** webhook secret rotation and webhook url changes failed with a 500 on PostgreSQL (their audit row had no `actorType`). Both work, and are audited in their transaction.
- **Changed:** a webhook request that supplies `secret` is refused with 400 (it was silently ignored).
- **Added:** `POST /webhooks/:id/rotate-secret` takes `overlapHours` (0–168, default 24); during the window deliveries also carry `X-Webhook-Signature-Previous`. Migration `0090`.
- **Security:** an access token that names no session is refused; an open Socket.IO connection is re-checked every 60 s and disconnected when its session, user or tenant no longer passes.
- **Docs:** the backend coverage figure is 100% of six layers, not the whole backend; a new `istanbul ignore` is reviewed like `eslint-disable`.

## 2026-09-25 — Phase 0 batch 7 ([record](./records/2026-09-25-phase0-batch7.md), ADR-060–ADR-073)

### Security
- Bulk deletes, sums, increments and restores are now tenant-scoped (W-33, W-34). Five tenant-user delete routes answered 500 before.
- Strict nonce CSP on every page.
- Tenant logos must be uploaded.
- Temporary passwords expire after 72 h (migration `0078`).
- Signed-in password checks are budgeted per user.
- Passkey removal and email change need re-authentication.
- Admins can remove a user's passkey.
- Redis requires a password; containers drop every capability.

### Changed
- Calibration records are append-only for the application role (`DB_APP_ROLE`, default `callibrator_app`).
- Background jobs run in explicit tenant context; audit rows are kept indefinitely.
- The DSAR export streams and is complete; signature history is paginated; attachments follow their parent's soft delete.
- Webhook delivery rows are purged after 30 days.

### Fixed
- The calibration scan's work orders rolled back (W-30); IoT anomaly alerts were never stored (W-32).
- Demo unseed stopped part-way.
- CI would have failed its first run.


## 2026-09-25 — Phase 0 batch 6 ([record](./records/2026-09-25-phase0-batch6.md), ADR-055–ADR-059, ADR-066, ADR-067)

*Section added 2026-09-28 from the record (ADR-088); the batch shipped without one.*

### Security
- Every route carries a permission gate or a reasoned exemption, checked over the real route tree (P6-04, ADR-058). Read paths are gated like their writes (AZ-01).
- Failed sign-ins are throttled per identifier and address; an account is never locked by anonymous attempts, and every failure answers the same 401 (A-185, ADR-059).
- The browser never holds the access token (A-71); OIDC is configured by discovery (A-188); a platform operator without MFA gets an enrolment-only session (P6-07).
- Files are served through a capability, not a public static mount (S-01, ADR-057).

### Changed
- Tenant administrators reach users, vendors, billing and the audit log (Q-20, ADR-056, migration `0054`).
- Workflow decisions on certificates re-authenticate and are signatures (ADR-055).

## 2026-09-25 — Phase 0 batch 5 ([record](./records/2026-09-25-phase0-batch5.md), ADR-053, ADR-054)

### Security
- Tenant secrets no longer copied into `tenants.settings` in plaintext; `PATCH /tenants/settings` accepts an allow-list only.
- Tenant export no longer returns password hashes, MFA secrets or decrypted settings.
- IoT device tokens stored as a hash only; OIDC gains state, nonce and PKCE.
- ClamAV scanning actually scans (it never had) and fails closed; uploads are quarantined until scanned.

### Changed
- **Breaking for webhook receivers:** signature is now `v1=` HMAC-SHA256 over `timestamp.body`; delivery is durable with retries up to about 20 h.
- Production logs JSON lines to stdout; log files only with `LOG_TO_FILE=true`.
- Tenants can require MFA; admins can reset a user's password or MFA; SCIM groups are per tenant.
- Search failures surface as errors instead of "No results".
- Migrations `0035`–`0044`, `0047`, `0049`.

### Fixed
- SSO had never worked; the finance routes locked out three admin roles.
- Scheduled backups backed up nothing; admin-created users had no role.


### Decided

- **ADR-051: the owner questions Q-09 to Q-19**, decided by two agents debating opposite positions. Audit rows are never purged; regulated records are protected from cascading deletes; a restore never re-creates a missing account; operators may not author Part 11 records inside a tenant. ADR-052 extends that to super admins in their home tenant. ADR-050: the client IP is resolved once, at the edge.

- **ADR-046 — the backend image builds from the repository root, and `/api/` belongs to the frontend** in every manifest. Makes `npm ci` against the committed lockfile possible. ([record](./records/2026-09-24-phase0-batch2.md))
- **ADR-045 — tenant lifecycle is a real feature.** It gets the schema it was written against (migration `0023`).

- **ADR-040 — electronic signatures are RSA-signed over a canonical payload, and verification verifies.** Until 2026-09-23 the "signature" was a SHA-256 of `documentId:userId:tenantId:Date.now()`, recomputed at verification — so **no genuine signature could ever verify** — and the per-tenant RSA key pairs signed nothing at all. Signing now uses the tenant's private key over a deterministic payload binding the document, signer, timestamp, authentication method and the signature's meaning; a soft-deleted key still verifies its past signatures; records signed under the old scheme are reported `unverifiable_legacy` rather than as valid or as forgeries. Signing without a provisioned key pair is now a 409. The reference deployment has **no** signatures (0 rows), so nothing in the archive is affected.

- **ADR-039 — PostgreSQL is the only supported database.** MySQL support was a claim, never a capability: `mysql2` was not a dependency, and search, webhooks and RAG used PostgreSQL-only SQL. The dialect is now fixed in `src/config/index.js`; any other `DB_DIALECT` refuses to start. ADR-029's tenant-isolation mechanism stands.
- **ADR-038 — the backend moves to TypeScript, strict, incrementally.** Supersedes ADR-030. Plan: `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`. Until it completes the backend is still JavaScript, and backend documents state TypeScript as the target, never as fact.

### Changed

- **Every dependency upgraded to its latest release**, with a fresh `package-lock.json`. TypeScript is held at 6.0.3 and ESLint at 9.39.5, because the tooling around them does not yet accept 7 and 10. `npm audit` now reports 0 vulnerabilities, down from 20. ([record](./records/2026-09-24-dependency-upgrade.md))

### Fixed

- **MFA did not work at all** on the installed otplib 13; a global test mock that accepted any code hid it. Rotation now requires re-authentication, and codes cannot be replayed. (A-99, A-114, A-115)
- **`GET /users` returned every user's TOTP secret.** (A-138)
- **Audit rows could be purged, or deleted with their tenant.** Both are now impossible, proven on PostgreSQL 18. Hard-deleting a user no longer erases their calibrations. (A-121, A-122)
- **Tenant backup failed on every call.** (A-108) **Workflow signing refused every real user.** (A-119)
- **Production leaked database internals in 500s**, while hiding every 4xx explanation. (A-132)
- **Tenant admins could create, list and delete tenants.** (A-76)

- **Tenant isolation did not reach includes.** A tenant's list could return another tenant's device name and user email through a join. Fixed for every include without changing any join type. (A-87, ADR-048)
- **Any authenticated user could edit or suspend any tenant.** (A-63) **A certificate could be approved or signed by a plain edit.** (A-64) **Anyone in a tenant could sign someone else's step**, and signing now always re-authenticates. (A-65, ADR-047)
- **QMS had no permission gate, no audit trail, colliding numbers, and a screen that had always rendered empty.** (A-66, A-73, A-74, A-75) Technicians and other non-admin roles no longer see QMS.
- **Device serial numbers are unique per tenant**, not globally. (D-04, ADR-049)

- **Logout never revoked a session, and a revoked session's token kept working for a day.** Tokens now carry `sid` and are checked on every request. (A-48)
- **The emailed activation token, the MFA-pending token and the socket token were valid bearer access tokens.** (A-59, A-52)
- **SSO put access and refresh tokens in the redirect URL.** Now a single-use 60-second code. **Deploy the frontend and backend together.** (A-60)
- **Every e-signature committed without its audit row and returned a 500.** (A-61) Twenty-five compliance mutations now write their audit row inside their transaction; a failed audit write rolls the change back. (A-41, A-42)
- **A certificate's approver was whoever the request body named.** (A-62)
- **Webhook signing secrets were caller-chosen and stored in plaintext.** Now generated, KMS-encrypted and rotatable. (A-51, F-18)
- **The tenant grace-period and offboarding job had never run.** (W-01)
- **The backend container crash-looped on a fresh VM** because the bind-mounted log directory was root-owned. (S-12)

- **Tenant isolation did not cover `bulkCreate` or `upsert`.** Twelve `TenantSettings.upsert` sites resolve on `(tenant_id, key)`, so a wrong tenant id overwrote another tenant's storage credentials or OIDC configuration. Both verbs now refuse a write naming another tenant. Verified against a real PostgreSQL. (D-01)
- **Tenant administrators were locked out of API keys, webhooks, storage settings and tenant backup.** The role level was never loaded and never seeded. (V-01)
- **The approval-workflow engine was SUPERADMIN-only** because five gates named `"workflow"` instead of `"workflows"`. The backend now **refuses to start** when any gate names a menu that is not seeded. (A-58)
- **Another tenant's id returned 403 instead of 404** in both authorization middlewares and in user management, which let a caller learn which ids exist. (AZ-04)
- **Restoring a tenant backup deleted every user and recreated them without passwords.** It now never deletes a live account. (S-02)
- **A global retention policy purged every tenant's rows**, audit logs included, ignoring legal hold. (D-03)
- **Restoring a soft-deleted device, user, tenant or role wrote nothing** and reported success. (D-07)
- **The public certificate check published a draft certificate's PDF**, at a guessable filename. (A-57)
- **One Redis restart disabled Redis until the backend restarted**, taking registration, passkeys, OIDC, shared rate limiting and queue deduplication with it. (W-05)
- **Deleting a role left its permissions in force for up to an hour.** (W-11)
- **Logging out left the realtime connection open and the tenant selection set**, so the next person in the same browser tab inherited the previous one's tenant. (F-01, F-06)
- **The dashboard's system-health panel was hardcoded green.** It now shows real dependency status to super-admins and nothing to anyone else. (F-02)

- **A bodyless request was a 500, and the validator was part of the problem.** Express 5 leaves `req.body` undefined where Express 4 gave `{}`, and Joi treats `undefined` as **valid** against a non-required object schema — so `validate(schema)` let an absent body straight through and the handler's first read threw. A request middleware now fills only an absent body, all 31 validator helpers coerce it, and 69 reads on unvalidated routes are guarded, so a bodyless request gets the 400 it is owed. (A-09)
- **Webhook deliveries followed redirects**, so a registered host that passed both SSRF layers could answer `302 Location: http://169.254.169.254/...` and this process would fetch cloud metadata from inside the deployment. Redirects are no longer followed; a 3xx is a delivery failure. (A-50)
- **Dead session-security middleware deleted.** It was imported by nothing and its SQL targeted a table that does not exist, so session fixation protection, a concurrent-session limit and IP binding were never in place — while eleven documents and four ADRs described them as real. Whether they should exist is now an Open Question instead of an assumption. (A-12)

- **`/search` returned rows the caller's role cannot list.** Each type is now filtered by running the same gate its own list route runs, so search cannot surface a record that resource would refuse. A principal with none of the searchable menus now gets 403 rather than a list. (A-04)
- **Socket.IO accepted any origin, took the token from the query string, and checked nothing at connect.** CORS now uses the same allow-list as HTTP, the token comes from `handshake.auth`, and a suspended tenant or inactive user is refused — as it is over HTTP. It also turned out `kanban:join` ran its access check with **no tenant context**, which the scope resolver reads as "skip the tenant predicate"; socket handlers now run inside the tenant context. (A-05)
- **`/health` published Node version, pid and memory to anyone, and checked only the database.** The public endpoint answers a verdict and nothing else; a per-dependency breakdown is super-admin-only; Redis and RabbitMQ are actually probed, and an unconfigured dependency reports "not configured" rather than healthy. (A-06, A-15)
- **A public `0.0.0.0:19883` port with nothing behind it**, removed from the VM and dev overlays. The backend is an MQTT client, not a broker. (A-17)
- **Stripe invoices never updated.** `upsertInvoice` only ever inserted, so an invoice that failed and was later paid stayed `Open` forever. `Paid` is now terminal and `amountPaid` never decreases, because Stripe does not guarantee event order and a late `payment_failed` carries `amount_paid: 0`. (A-25)
- **Redelivered queue messages did the work twice** — a duplicate email, a batch job run again. Consumers now claim a stable identity from the message body before acting. This is at-least-once with a claim, not exactly-once, and the code says so. (A-26)
- **Calibration evidence, signing keys, controlled SOPs and the risk register were mutable by any role.** All gated; publishing an SOP you authored is now a 409 with a state explanation; deleting an attachment is a soft delete with an audit row, refused outright once the parent certificate is approved or signed. (A-28)
- **The rate limiter never used Redis.** Its client was built inside a function nothing called, so every counter lived in process memory: lockouts reset on each deploy and each replica had its own. Now on the shared client, with an atomic Lua increment; on a Redis outage it falls back to memory rather than failing open. Verified against a real Redis — and against a dead one, to prove the tests can fail. (A-30)
- **`JWT_REFRESH_SECRET` signed nothing.** The key registry holds the access secret, and refresh tokens were signed from it. Tokens now carry a type claim, refresh tokens use the refresh secret alone, the algorithm list is pinned in code, and the backend **refuses to start** if the two secrets are equal or the algorithm is unsupported. (A-31)
- **SCIM PATCH ignored `path`**, the form every major IdP sends, so a deprovision returned 200 and left the account active. Paths are honoured now, an unsupported one is a 400 rather than a silent success, and `userName eq` filters return one user instead of the whole tenant. A missing role guard on group membership was closed at the same time. (A-33)
- **Every per-user permission override silently did nothing** — including `none`, which is a revocation. The matrix was keyed by menu name while every route looks it up by slug. (A-35)
- **Every RabbitMQ call opened a new connection and nothing closed it.** The cache guarded on `connection.isOpen`, which amqplib does not define — the same shape as the ioredis `.connected` bug, kept green by a mock that invented the property. Liveness now comes from the events amqplib really emits. (A-36)
- **The access log was never pruned.** `history: "30d"` names a *file* in `rotating-file-stream`, not a retention period, so the log grew without bound and a file literally named `30d` was created. (A-44)
- **A decommissioned IoT device kept ingesting, and one bad MQTT message shut the server down.** The unscoped lookup dropped the soft-delete predicate; the message handler's rejection was unawaited and uncaught, so it reached the process-level handler that calls `shutdown()`. (A-45)
- **The backend lint gate had never run.** A version mismatch crashed ESLint before it linted a file, and `make verify` runs lint first. It runs now; its 1,319 findings are formatting and are their own commit. (A-34)

- **Any account could mint an unrestricted API key and have SCIM make it SUPERADMIN.** API-key issuance was open to every authenticated user, scopes were whatever the caller sent (`["*"]` accepted), SCIM accepts any API key as a service account, and the SUPERADMIN role id is a constant committed to this repository. Issuance is now `TENANT_ADMIN`-only, scopes must name a real menu slug and action, and SCIM refuses to assign SUPERADMIN or an unknown role and refuses to rename, patch or delete a system role. The 2026-09-21 write-up said SCIM was `auth`-only — it is not; see the record for the correction. (A-27)
- **Any authenticated principal could re-parent another hospital's tenant.** The `Tenant` model has no `tenantId` attribute, so the global scoping hooks never applied to it, and three `tenant-hierarchy` mutations carried `auth` alone. Reads of a named tenant are now the caller's own tenant or **404**; re-parenting and `cross-tenant-roles` are SUPERADMIN-only and refuse API keys. (A-01)
- **Webhooks, storage settings and custom domains were open to every role** — the lowest role could point the tenant's uploads at a bucket it owned, or its event stream at a host it controlled. Now tenant-admin (webhooks, storage) and the `custom-domains` menu gate (domains), with API keys refused on writes. (A-02)
- **API-key scopes were read only by `dynamicAccess`**, so on any route gated another way — or by `auth` alone — a key scoped `warehouse:read` was simply an authenticated principal. Authorization for API keys is now deny-by-default, refused at the controller boundary unless a gate authorized the key. (A-03)

- **Self-registration, passkeys and the OIDC provider were broken in production.** Every helper in `redis.service.js` guarded on `client.connected` — a node-redis v3 property that **ioredis does not have** — so each returned early while Redis was up and healthy: no cache write, no lock, no WebAuthn challenge, no OIDC authorization request ever stored. Verified live before the fix: `POST /auth/register` answered **429 "Registration in progress"** even for a duplicate, and `POST /webauthn/registration-options` answered **503**. The unit test's ioredis mock fabricated a `connected` getter, so the suite stayed green; the getter is gone. Readiness is now `client.status === "ready"`. (A-24)
- **Metered billing read every tenant's usage as zero in production.** `getUsage` and `resetUsage` passed `$1`-style placeholders as Sequelize `replacements`, which only substitutes `?` / `:name`. PostgreSQL answered `there is no parameter $1` on every call — proven against a real PostgreSQL 17 — and `getUsage`'s `catch` turned that into `{ total: 0 }`. The MySQL branch beside it was correct and never ran; the test for the PostgreSQL branch asserted `replacements` as correct behaviour. Now `bind`.
- **RAG no longer answers from the wrong documents on a non-pgvector engine** — the recency fallback is removed with MySQL.

### Found, not yet fixed

- **Audit rows are written after the response, outside the transaction**, on `res.on("finish")`. A rolled-back action can leave a row saying it happened; a committed one can leave none. (A-41)
- **A failed audit write is announced only to `console.error`**, and production writes nothing to stdout — so a compliance record that fails to persist fails silently and durably. (A-42)
- **Revocation does not revoke.** Nothing in the request path reads `sessions`, and the deployed `JWT_ACCESS_EXPIRED` is `1d` where the documentation says `15m`: a revoked session keeps working for up to a day. (A-48)
- **SCIM user creation is a cross-tenant existence oracle** — globally unique email, tenant-scoped duplicate check. (A-37)

- **SCIM PATCH ignores `path`.** `patchUser` reads `op.value` as an object only, so the RFC 7644 form every major IdP sends — `{ "op": "replace", "path": "active", "value": false }` — is silently dropped and the endpoint answers **200 with the user unchanged**. Deprovisioning appears to succeed while the account stays active. (A-33)

### Corrected documentation

More claims found false on 2026-09-23, each corrected where it was made:

- **ADR-017 "User Sessions Bound to IP and User Agent" was never implemented.** The decision was recorded, propagated into six `docs/` files as fact, and the only code that claimed to enforce it was imported by nothing and queried a table that does not exist. Deleted; eleven documents and four ADRs corrected; whether the controls should exist is now an Open Question rather than an assumed feature. (A-12)
- `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` said `config/socket.js` was the only stdout output in production. There are **25** `console.*` sites, and the one that matters announces a failed audit write.
- `docs/DEVOPS/06-LOGGING.md` described a log redactor as as-built. **There is none**, and it recorded access-log retention that did not exist.
- `docs/API/13-INTEGRATION-API.md`: SCIM responses are wrapped in the platform envelope (no compliant client can parse them), `DELETE /Users` calls `destroy()` rather than deactivating, and credentials are encrypted with `KMS_MASTER_KEY`, not the `ENCRYPT_KEY` it named.
- A-29 said nothing sets `iotEnabled`; the demo seeder does. The conclusion stands, the premise was too broad.

Claims found false in the 2026-09-21 audit, each corrected where it was made:

- there is **no embedded `aedes` MQTT broker** — the backend is an MQTT client of an external broker, off unless `MQTT_HOST` and `MQTT_PORT` are both set; `aedes` is an unused dependency;
- `docker logs` is empty in production because **the application writes nothing to stdout** there (winston's Console transport is development-only), not because of initialisation timing; per-request `logger.http` lines are also dropped in production by level;
- there is **no `pre-push` hook, no secret scanner, no IDOR enforcement script and no `scripts/verify.sh`** — documented as mitigations for deferred CI, none of them exist;
- RAG on a non-pgvector engine did not become "unavailable"; it silently returned the most recent chunks.


### Changed

- **Repository restructured into a documented monorepo.** `docs/` now holds 135 as-built documents across ten categories, `MEMORY/` and `TASKS/` follow the wedding-saas layout, `deploy/` carries the compose stacks and Helm charts, and a Makefile drives development and deployment. Root markdown files were classified into `docs/` rather than deleted. — [record](./records/2026-09-10-monorepo-restructure-and-as-built-docs.md)
- **`docs/` is now as-built.** Every document is grounded in `backend/src` and `frontend/src` and names its source files, replacing a specification that described a system built differently.
- **`CLAUDE.md` and `AGENTS.md` rewritten.** The previous `CLAUDE.md` instructed engineers and agents to write strict TypeScript with no `any` — for a backend that is JavaScript.

- **First production deployment.** Running on a single host behind a Cloudflare tunnel. Nine defects were found doing it, **none of them reachable from a test** — an unanchored `.gitignore` pattern that excluded six committed source files from clean clones, an undocumented fourth required secret, and a proxy rule that broke browser login while the backend answered 200. All fixed in the repository, not only on the host. — [record](./records/2026-09-10-first-production-deployment.md)

### Added

- **ADR-029 through ADR-037** — nine decisions recording what was actually built: ORM-layer tenant isolation, the JavaScript backend, Socket.IO retained, compose-first deployment, password-primary authentication with OIDC both directions, database-backed sessions, the certificate 409, derived tenant `subdomain`, and the three-value tenant status.
- `deploy/compose/` — a base stack plus dev, staging, production and **vm** overlays, with an nginx configuration covering the five routes that fail confusingly when got wrong.
- `KMS_MASTER_KEY` as a documented fourth required secret — generated by `make secrets`, refused by `make check-env`.
- `deploy/helm/callibrator/` — an umbrella chart with backend and frontend subcharts, and **render-time guards** that refuse a missing `image.tag` and refuse `cron.enabled` with more than one replica.
- A `Makefile` whose `preflight` target **refuses** to deploy on `NODE_ENV != production`, `SEED_DEMO=true`, a wildcard CORS origin, a `:latest` tag, or an ACME URL still pointing at Let's Encrypt staging.
- `MEMORY/templates/` — change record, feature spec and phase summary.
- `docs/ARCHIVE/` — superseded root documents, kept for provenance and never authoritative.

### Fixed

- **The Device Calibrator brand is wired in.** The supplied `icon.svg` was a CorelDRAW sheet holding four variants on one artboard; they are cut into `frontend/public/brand/` and the mark is inlined by `components/brand/BrandIcon.tsx` so it adapts to both themes and sidesteps next/image's SVG rejection. It replaces the generic lucide `Shield` that stood in for a logo in the sidebar, the landing navigation and the auth panel. A tenant's own logo still wins where one is configured.
- **The activation and password-reset emails were broken in Outlook.** Both templates carry an Outlook-only (`[if mso]`) VML button that the vendor left pointing at its own site: the activation email showed a button labelled **"Reset Password"** linking to `viewstripo.email` instead of the activation link, and the OTP email showed that same button *instead of the code* — an Outlook recipient never saw their OTP. The activation button now uses the real link, and the OTP branch renders the code.
- **Interpolated URLs were entity-escaped.** Mustache's `{{ }}` escapes `/` to `&#x2F;`, so every URL rendered as `src="https:&#x2F;&#x2F;host&#x2F;…"`. Strict parsers decode it; email clients are inconsistent. URL placeholders now use `{{{ }}}`. (The certificate PDF was never affected — it has its own substitution that inserts the QR data URI raw, deliberately.)
- **Google Fonts `<link>` removed from all three templates.** It is ignored by most mail clients and discloses every open to a third party.
- **Outbound emails no longer hot-link a third party's logo.** All three templates hard-coded `https://fullfind.co` — 21 URL references, **plus the company name as readable footer text**, which a case-sensitive search for the domain missed entirely — from the boilerplate this project started from. Beyond carrying the wrong branding, it made every recipient's mail client fetch an asset from that domain, handing them the open events for every activation and password-reset email. Now resolved from `HOST_URL` and `MAIL_FROM`.
- **`/public` was 404 in every container.** `index.js` mounts `express.static(appPath("public"))`, and the backend Dockerfile never copied the directory — working from a source checkout, missing from the image.
- **A real default avatar for users with no photo.** The placeholder is the same SVG that sits in `backend/uploads/profile/`, committed to `frontend/public/` instead — in its original location it is gitignored, absent from deployed hosts, and shadowed by the uploads bind mount. Rendering it needed `unoptimized`: `next/image` answers **400 for SVG** unless `dangerouslyAllowSVG` is set, so the placeholder would have been a broken image again. That flag is deliberately **not** set — uploaded avatars are user-supplied and an SVG can carry script, so only our own asset bypasses the optimizer.
- **Avatars and tenant logos rendered as broken images.** `users.avatar_url` and `tenants.logo` default to `"default.svg"`, a sentinel the service layer already honours in six places — but the four URL builders did not, so they produced `/uploads/profile/default.svg`, which 404s: nothing ships that file, `backend/uploads/` is gitignored, and `/app/uploads` is a bind mount that would shadow it anyway. Now single-sourced as `DEFAULT_UPLOAD_PLACEHOLDER`; a user with no photo gets the initials block the UI already had. The public branding endpoint was affected too, so the broken logo showed **before sign-in**.
- **The frontend image could not be built.** `frontend/package.json` overrode `eslint` to an exact version while also declaring it a direct devDependency — fine at the workspace root, `EOVERRIDE` inside the container, so `npm install` succeeded locally and only the image build failed. Now npm's `"$eslint"` reference.
- **`npm test` did not run.** The backend scripts invoked `node node_modules/jest/bin/jest.js`, a hardcoded path that stops resolving once a workspace install hoists jest to the repo root; it failed with `MODULE_NOT_FOUND`, which looks nothing like a test failure and made `make verify` unusable. This is what had been hiding the true state of the coverage gate.
- **Five stale failures in `webauthn.service.test.ts`.** The credential stand-ins lacked `getClientExtensionResults()`, the expected payloads omitted two fields the implementation sends on purpose, and one asserted a `userHandle: null` shape the implementation never produces. Test scaffolding, not product bugs — the frontend suite is now green at 69 suites / 677 tests.
- `GET /menu-groups/menu-groups/admin` answered **500**. Express 5 leaves an absent body `undefined` rather than `{}`, and the handler — which serves two GET routes — read `req.body.roleId` unguarded. The sidebar was unaffected, so only the permissions-configuration screen was broken.

### Known open items

- ~~The backend unit-test coverage gate (100%) is currently failing.~~ **Verified passing 2026-09-11** — 289 suites, 5735 tests, 100% statements/branches/functions/lines.
- The `automate/` Playwright suite (71 browser tests) is **documented but not in this repository** — U-07.
- The live E2E suite has **never passed in one uninterrupted run** — every fix verified individually.
- `calibration_records` append-only is a **convention, not a constraint** (PR-2).
- Swagger and the enforced Joi validators disagree for the GDPR endpoints.
- The Helm charts render; **no cluster has been reachable** to validate them.

---

## 2026-09-23 — The lockfile is committed ([record](./records/2026-09-23-a21-lockfile-npm.md), ADR-044)

*Entry added 2026-09-27 (ADR-088).*

- `package-lock.json` is committed and `make install` is `npm ci`; every Makefile target uses npm (A-21).

## 2026-07 — Full-stack integration audit

Full account: [`../docs/ARCHIVE/2026-07-fullstack-integration-audit.md`](../docs/ARCHIVE/2026-07-fullstack-integration-audit.md). 51 route modules audited against a running server; 24 defects found, 15 fixed and re-verified live.

### Fixed

- **Authentication, platform-wide** — every token was rejected 15 minutes after login. `verifyAccessToken` passed `maxAge: "15m"` while tokens are signed `expiresIn=1d`.
- **Certificates** — the list returned zero rows while rows existed. Four includes defaulted to INNER JOINs, and every draft has a null actor FK.
- **Certificates** — approval was unreachable: no `submit` transition existed, and approving a draft threw a plain `Error` that surfaced as a 500. Added `POST /:id/submit` and mapped invalid states to **409**. — ADR-035
- **Risks** — risks with no assignee were invisible: absent from lists, 404 on get, update and delete. Same INNER JOIN shape.
- **QMS and SOP** — lists rendered empty because rows were returned inside `data` rather than `data` plus a top-level `meta`.
- **QMS** — a bad enum on `PATCH /nc/:id` reached the database and 500ed; added a validator so it returns 400.
- **Tenants** — every create returned a 500 `notNull` violation. `subdomain` is now derived from `code`. — ADR-036
- **Tenant lifecycle** — suspend, resume and offboard all 500ed with `invalid enum value`. Status is three values; granular state moved to `tenant_settings`. — ADR-037
- **Data retention** — the nightly purge failed **every night** with `column "tenantId" does not exist`; the `sessions` model attribute is `tenant_id`.
- **Data retention** — legal hold always 500ed: a Joi schema was spread into a plain object, then `.validate` called on the result.
- **Workflows** — create, update and submit-action all 500ed: `db` was destructured from the models barrel, which exports `sequelize`.
- **Feature flags, tenant lifecycle, data retention** — several endpoints 400ed every request because path parameters were validated in the body.

### Added

- 51 live E2E specs at `backend/src/tests/e2e/modules/`, run against a running server.
- 51 frontend contract tests, one per service, asserting the exact path, method, payload and envelope unwrap.
- A flag-gated demo seeder (`SEED_DEMO=true`) — ~80 rows, idempotent, with teardown.

### Note

**3,863 tests passed while 13 endpoints were broken.** Frontend services had been written against endpoints that did not exist, with tests mocking the fabrication. That is why the live E2E layer exists.

---

## 2026-07 — Tenant isolation moved out of the database

### Changed

- **Row Level Security removed.** Isolation moved to global Sequelize hooks reading an `AsyncLocalStorage` context, **deny-by-default**, engine-agnostic. Migration `0012` added RLS; `0015` removed it. Both are kept. — ADR-029

Two reasons: RLS is PostgreSQL-only and the platform must also run on MySQL, and the policy carried a fail-open branch — `app.current_tenant = ''` matched **every row**.

### Changed

- **Realtime stays on Socket.IO.** A plain-WebSocket hub was trialled and reverted by decision. — ADR-031

---

## 2026-07 — Pluggable object storage

### Added

- Object storage behind one port with three drivers — `local`, `s3`, `nfs` — selectable globally and **overridable per tenant**, with tenant credentials encrypted at rest. Verified live against MinIO. Migration `0016` added `attachments.storageKey`.

Tenant-supplied S3 endpoints are SSRF-checked; operator-configured ones deliberately are not, because an internal host is a legitimate operator value.

---

## Earlier

The platform reached 33 modules, 72 models, 53 route modules and 342 test files before this changelog existed. That history is reconstructable from `MEMORY/DECISIONS.md`, the migration sequence in `backend/src/migrations/`, and [`../docs/BACKEND/10-MODULE-REFERENCE.md`](../docs/BACKEND/10-MODULE-REFERENCE.md).

**The gap is the point of the file.** Everything above had to be reconstructed by reading code and audit reports, which is exactly what a changelog exists to make unnecessary.
