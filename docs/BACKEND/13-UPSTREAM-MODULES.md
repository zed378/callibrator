# 13 — Upstream Adoption Modules, As Built

> **What this is.** The as-built reference for the modules the **upstream PHP feature adoption**
> (Phases 12 … 31) added to this backend. [`10-MODULE-REFERENCE.md`](./10-MODULE-REFERENCE.md)
> indexes 35 modules and predates this work; this document is the missing chapter for the eleven
> modules that adoption produced. It is **as built**, not as planned: every route module, model,
> migration and service named here exists in the tree, and each claim carries its file.
>
> **Not covered:** the upstream application itself (`docs/UPSTREAM/00` … `08`) and the frontend
> screens (`docs/FRONTEND/`, `docs/UPSTREAM/13-USER-GUIDES-ID.md`).
>
> **Honest state.** Two things in this surface are built but **not proved in production**: no real
> upstream data has been loaded (`UPSTREAM_REAL_DATA_ALLOWED` is false; the owner's legal decision
> `OA-5` gates it), and the legacy QR sticker's format is unknown (`OA-4`), so the legacy resolver
> (P27-02) is unbuilt. Where that matters below, it says so rather than implying completeness.

---

## 1. How to read this

Each module follows the same shape: **what it is**, **routes**, **models and tables**, **services**,
**the controls that hold it together**, and **what is open**. The ADRs are cited by number because
they are the decisions; this document is the map to the code.

Shared facts that apply to every module below:

| | |
|---|---|
| **Second isolation dimension** | `client_facility_id` (ADR-124). Every device-anchored table carries it NOT NULL with a composite FK; `attachments`, `warehouses`, `non_conformances`, `users`, `audit_logs` carry it nullable. Enforced by the same tenant hooks, deny-by-default. |
| **Contract-first Zod** | Request shapes are Zod schemas under `@callibrator/contracts`, mounted with `validate(schema)` (P9-11). The published contract is `backend/openapi.json`, generated from per-route `*.openapi.ts`. |
| **Audit** | Every mutation writes an audit row **inside the action's transaction** (`audit.service#logAction`), `client_facility_id` stamped from the resource. |
| **Two-tenant tests** | Every new `:id` route has a two-tenant test asserting **404** (not 403), and a two-facility twin where the facility dimension applies. |

---

## 2. The Inspection Catalogue — `deviceTypes.route.ts`, `ipm.route.ts`

**Decision:** ADR-125. **Tables:** `device_types`, `inspection_item_definitions`,
`inspection_templates`, `inspection_template_versions`, `inspection_template_items`,
`inspection_template_proposals` (global — no `tenant_id`). **Models:**
`deviceType`, `inspectionItemDefinition`, `inspectionTemplate`, `inspectionTemplateVersion`,
`inspectionTemplateItem`, `inspectionTemplateProposal`.

The catalogue is **global and versioned**. The platform operator writes it; a tenant only
**proposes**. A published version is immutable, and every IPM session **pins** the version it used,
so a later catalogue edit cannot change what a submitted report says.

- Routes: `/device-types` (CRUD, operator-only), `/ipm/item-definitions`, `/ipm/templates`,
  `/ipm/templates/:id/versions`, publish, `/ipm/published-catalogue` (readers, with a strong ETag and
  304), `/ipm/template-proposals` (a tenant's own) and the operator's proposal queue.
- The parser and evaluator live in `@callibrator/contracts` (`inspectionValues`): `parseDecimal`
  (decimal comma, grouping refused), `parseLimit`, `normaliseUnit`, `evaluate`, and
  `resolveTemplateVersion`. The server and the capture screen apply the **same** functions, which is
  why a value the screen flags is the value the server refuses.
- `inspectionCatalogueGlobal.guard` fails a write route on the catalogue that is not operator-only.

**As built:** P21-01 (2026-10-09), migration 0125. **Open:** none in the code; the operator's
advisory identifying-text lint (AM-29) is a warning, not a block.

---

## 3. The Device Register — `calibrationDevices.route.ts`

**Decision:** ADR-132 (register extensions), ADR-133 § 2 (calibration dates), ADR-124 § 3 (facility).
**Migration:** 0128. **Model:** `calibrationDevice` (extended).

- `qr_code` — normalised by `normaliseQrCode` with the tenant's settings, **unique per tenant over
  every row** (a soft-deleted device keeps its QR; restore is the way back). Only provider staff
  write it.
- `condition` is a **separate observation** from `status`. `Rusak` also sets `status = inactive`;
  the two change independently.
- **Rooms** are `warehouses` of `kind = room`, owned by a facility, with a floor. A device's room is
  kept in its facility by a trigger; the register form finds-or-creates one.
- **Photos** are `attachments` with a `purpose` (`device_front`, `device_serial_plate`,
  `device_other`); one live front and one live serial-plate per device (a partial unique index).
  Upload is JPEG/PNG by content; **HEIC is refused 415 `PHOTO_HEIC_UNSUPPORTED`** and converted on
  the client (ADR-132 Am. 3) — the server has no HEVC decoder. Derivatives are built in pure
  JavaScript (`jpeg-js`, `pngjs`), so the `pkg` image carries them.
- **QR lookup** `GET /calibration-devices/by-qr/:qrCode` is facility-accessible; another tenant's or
  facility's QR answers the **same 404** as an unknown one (N-13).
- **Move** `POST /calibration-devices/:id/move` — one audited operation (ADR-124 Am. 2 § 2): the
  children follow, the storage keys are re-segmented (`attachments.rekey_pending` + a re-key job),
  and the move is refused into a non-active facility, for a retired device, with an open IPM draft,
  or when the serial already exists in the target.
- **Calibration dates** `POST /calibration-devices/:id/calibration-dates` — records an external
  laboratory's date and key data with **no file**; the next due date is re-derived from the latest
  **effective** record on create, correction and void (G-11 fixed).

**As built:** P21-02a/b (2026-10-09), P21-05, P21-09d. **Open:** the calibration-due index was
measured on PostgreSQL 18 (0.1 / 1.9 ms) and **not added** — recorded, not forgotten.

---

## 4. IPM Sessions — `ipmSessions.route.ts`

**Decision:** ADR-126 (an issued record), ADR-127 (offline idempotency). **Migrations:** 0126
(sessions, results, signatures, idempotency keys), 0127 (immutability). **Models:**
`inspectionSession`, `inspectionResult`, `inspectionSessionSignature`, `idempotencyKey`.

An IPM is **many per device**, draft → submitted, corrected by **supersession**, voided with a
reason, and **never edited after submit or deleted**. "Due" is computed from an interval, not
enforced by a month rule.

- Draft life: `POST /ipm/sessions` (prefill; a repeated `clientRef` answers the same draft),
  `GET/PATCH /:sessionId`, `PUT /:sessionId/results` (the rows replaced wholesale at a revision),
  `POST /:sessionId/discard`.
- The end of the draft: `POST /:sessionId/submit`, `POST /:sessionId/corrections`,
  `POST /:sessionId/void`.
- **Immutability is a constraint, not a convention** (0127): an `ENABLE ALWAYS` trigger refuses
  DELETE/TRUNCATE for every role, refuses a change to a submitted session except in its lifecycle
  columns (each once), and refuses a result change once the session left `draft`. The device-move
  exception is the only path that may change a facility.
- **Revision and conflict:** every draft write carries `revision`; a stale one is **409
  `IPM_REVISION_CONFLICT`**, and every 409 carries a top-level `code`.
- **`Idempotency-Key`** (ADR-127 § 4) is honoured on every draft write and on `POST /attachments`;
  the store is `idempotency_keys`, purged nightly. A replayed request answers the stored result; the
  **same key with a different body is 409 `IDEMPOTENCY_KEY_REUSED`**.
- `POST /field/wipes` records an administrator's wipe of another user's field data (ADR-135, AM-23)
  with counts only.

**As built:** P21-03a/b/c (2026-10-09), P21-04 (submit, issuance, side effects), and the fix for the
`Idempotency-Key` double-write crash (ADR-127 Am. 5, 2026-10-12).

---

## 5. The IPM Report and Its Signatures — `ipmReports.route.ts`

**Decision:** ADR-126 § 8, ADR-095 § 4 (no stored PDF), ADR-107 (signed snapshot). **Model:**
`inspectionSessionSignature`.

The report is a **document of the session**, not a certificate, and it is **rendered in the
frontend** — the backend stores no PDF.

- On submit, one transaction issues the report: a number `IPM-<facility code>-<YYYYMMDD>-<NNN>` per
  facility and day in the tenant's zone, a 192-bit verification token, the content hash
  (`ipm-report-v1`) over the stored results, and the issuer and the snapshots (device, facility,
  performer, calibration dates) taken **at submit**, so a later rename or move changes nothing.
- `GET /ipm/sessions/:id/report-document` serves the data document. `?render=pdf` is the **audited**
  read the download uses (G-R10), so every downloaded PDF comes from a fresh read, never the copy on
  screen.
- `POST /ipm/sessions/:id/signatures` — the performer's signature, and the IPSRS **countersignature**
  behind the tenant setting `ipm_countersign_enabled`. The submitter cannot countersign (403
  `IPM_COUNTERSIGN_SOD`); an unbound facility user cannot (403 `IPM_COUNTERSIGN_FACILITY`).
- `GET /ipm/verify/:reportNumber` is **public** and answers one 404 for every failure; the browser
  recomputes the hash to verify a printed report.

**As built:** P21-04 (2026-10-09), P23-02 (renderer, 2026-10-10), the evidence-photo section
(C-2, 2026-10-23).

---

## 6. Client Facilities and Facility-Bound Users — `clientFacilities.route.ts`

**Decision:** ADR-124 and its Amendments 1 … 6. **Migrations:** 0117 (facilities), 0118 … 0123 (the
facility column across the device-anchored tables), 0124 (menus). **Models:** `clientFacility`,
`clientFacilityMove`.

A **client facility** is a health facility the tenant serves. A **bound user** is confined to one
facility by a **second, deny-by-default scope** applied by the same hooks — cross-facility is a
**404**, identical to cross-tenant.

- Eight routes: list, `/options`, get, create, edit, status, delete, and `/:id/users`.
  `PUT /users/:userId/client-facility` binds, re-binds, unbinds and confirms, behind the setting
  `FACILITY_BINDING_ENABLED`; a binding change **revokes the user's sessions**.
- The **bound menu ceiling** is applied in `effectivePermission`, so a bound HEALTHCARE ADMIN does
  not see admin pages that would 403 — an unauthorised surface is **absent**, not hidden.
- The database, not only the service, holds the invariants: `facility_insert_default`,
  `facility_column_guard` (a facility changes only through a move), `facility_accepts_inserts` (an
  `ended` facility takes no new record), the bound-role trigger, and the AM-7 deferred constraint
  triggers that keep an attachment's facility equal to its resource's.
- A move's children follow along **one path**; `client_facility_moves` records it, and a commit that
  leaves a move `in_progress` is refused.

**As built:** P20-07 (migrations, 2026-10-08), P21-09a … e (the dimension, the routes, the move and
keys, the A-90 sweep). **Open:** the § 11 gate of `docs/SECURITY/15` is **not green** (G-22, G-26 …
G-30, the live twins).

---

## 7. The Public Device Page — `publicDevices.route.ts`

**Decision:** ADR-138 (P12-06), spec P19-07. **Migration:** 0137. **Model:** `publicDeviceToken`.

Reached only by a **revocable 128-bit capability token printed on new stickers**, stored as its
SHA-256. Staff routes under `/calibration-devices/:id/public-token` issue, rotate and revoke
(unbound staff, audited, 409s); deleting a device revokes.

The public read `GET /api/v1/public/devices/:token` is **the one exempted route**: a reviewed
`skipTenantScope` on the token row only, its own rate limits (120 per address, 30 misses, 3 000
global per 15 minutes), an **identical 404 for every failure**, `no-store`/`noindex`/`no-referrer`,
and an **allow-list** answer — never a serial, QR number, room, photo, document, person's name or id.
The tenant setting `public_device_page` (`off` by default, `minimal`, `minimal_with_report`) decides
how much is shown.

**As built:** P21-08 (2026-10-13), P22-08 (the page). **Open:** the legacy sticker's format is
unknown (**OA-4**), so a legacy URL cannot redirect to `/d/<token>` — only the hash is stored — and
the spec answers a static "sticker replaced" notice instead (UD-16).

---

## 8. Invitations for Imported Users — the users surface

**Decision:** ADR-139. **Migrations:** 0143 (`users.awaiting_invitation`), 0144 (`user_invitations`).
**Models:** `user` (extended), `userInvitation`.

An account imported from the upstream **cannot get in by a password reset or single sign-on**. It is
marked `awaiting_invitation`, and only an invitation the provider issues opens it.

- `GET/POST/DELETE /users/:userId/invitation` — issue, send again, withdraw, and read the state
  (TENANT ADMIN; no API key; not facility-accessible). The token is stored **hashed only**, one live
  per user, valid 7 days.
- The **pre-invitation gate**: issue is 409 `PRE_INVITATION_GATE_OPEN`-adjacent until the platform
  operator opens the tenant's `upstream_invitations_open` flag (the operator's route
  `PATCH /admin/tenants/:id/flags`).
- A **shared facility account** must name the person who will use it at issue time — recorded in the
  audit trail, which is what makes the account attributable.
- The nightly `unclaimed-invitation` job (03:47, singleton, monitored) marks INACTIVE an account
  still awaiting 30 days after its **first** invitation. An account never invited is untouched.

**As built:** P24-08 (2026-10-22), P24-09a … d (2026-10-22/23).

---

## 9. The Offline Field App's Backend — `field.route.ts`

**Decision:** ADR-127. **Spec:** P19-08.

The field app is a **one-document PWA** (worker scope `/field`); the backend's part is narrow and
deliberately so:

- `GET /calibration-devices?view=field` returns the narrow `fieldDeviceSummary` — the working set,
  not the full device shape.
- `POST /attachments` honours `Idempotency-Key`; `resourceType: inspectionsession` with
  `purpose: ipm_evidence` is accepted **only** on the caller's own draft (403 otherwise; a submitted
  session is 409 `IPM_NOT_DRAFT`).
- Tenant and account refusals carry `SCOPE_LOSS_CODES` with a top-level `code`, which is what tells
  the app to purge its working set rather than retry.
- `POST /field/wipes` is the audited administrator wipe.

**As built:** P21-03c (2026-10-09), P22-10a … c3 (2026-10-10/12). **Open:** the real-phone run is the
owner's (`TASKS/RUNBOOK-FIELD-REAL-DEVICE.md`, OPEN).

---

## 10. The Upstream ETL — `upstreamFileImports.route.ts`, the SQL-dump import, and the transform

**Decisions:** ADR-129 (SQL dump, parsed never executed), ADR-130 (rsync images), ADR-129 Am. 1 … 10
(the transform). **Migrations:** 0113, 0114 (the two import rows), 0133 (the transform role,
`id_map`, `quarantine`), 0134 … 0141, 0145 (the transform's per-step grants). **Models:**
`upstreamFileImport`, `upstreamSqlImport`.

Three pieces, one direction: **extract → stage → transform → load**, per client facility of one
provider tenant.

1. **SQL-dump import.** A super-admin uploads a mysqldump (≤ 200 MB, plain or gzip) into a
   quarantine; a background job **parses — never executes —** it: only `CREATE TABLE` and
   `INSERT … VALUES`, everything else counted and discarded, the tables and columns
   `docs/UPSTREAM/07` allows (deny by default) staged as `upstream_import.stg_<table>` by the import
   role `callibrator_import`. **`callibrator_app` cannot read that schema** — proved as the
   application role, not the owner.
2. **rsync image import.** A super-admin confirms the source host key, a job rsyncs
   `foto_depan`/`foto_sn` into a quarantine, and `docs/UPSTREAM/08`'s ingest puts them in the
   tenant's scope with GPS removed and a manifest for the transform. The credential is KMS-encrypted
   and **erased with the import**.
3. **The transform** (`services/upstreamImport/transform/`) runs in **one transaction** on a third
   connection switched to the role `callibrator_transform`. Every staged row is **mapped** (in
   `id_map`) or **quarantined with a reason**, or the run fails `TRANSFORM_INCOMPLETE` — "dropped
   silently" does not exist. It writes into a **provider tenant the operator names** with the
   request, and never creates a tenant. Thirteen steps in `docs/UPSTREAM/05` § 3.1 order: facilities,
   users, device types, item definitions, templates, laboratories, rooms, devices, photos,
   calibrations, IPM sessions, results, audit rows.

**Both imports are gated by `UPSTREAM_REAL_DATA_ALLOWED`** (default off), re-checked when a job
starts so turning it off stops a queued real import.

**As built:** P24-01 (mechanism), P24-02a … g (every transform step), P24-03 (step 9, the photos,
2026-10-23 — the transform is now available), P24-06, P24-07. **Open:** the **dry run** (P24-05) and
therefore reconciliation (P25) and UAT (P26) await the owner's legal decision (**OA-5**, UD-18); the
end-to-end proof to date is synthetic.

---

## 11. What Holds This Together (the controls, named)

| Control | Where |
|---|---|
| Second isolation dimension | `utils/tenantScope.util.ts` (the hooks), `utils/facilityPredicate.util.ts` (`facilityClause`), the route gate from `tenantContextMiddleware` |
| Raw SQL carries its predicate **bound** | `utils/sql.util.ts#sql`; `rawSqlTenantPredicate.d05` and its facility twin; `RAW_SQL_UNREACHABLE_BY_BOUND` lists reviewed exemptions |
| Every route has a gate | `guards/routePermissionGuard.p604` |
| Every new `:id` route has a two-tenant test | `guards/twoTenantRoutes.guard`, `twoTenantSuite`, `twoFacilitySuite` |
| Immutability is a constraint | migrations 0127 (IPM), 0057 (`calibration_records`), 0091 (`audit_logs`), the catalogue's no-delete triggers |
| The catalogue is operator-only | `guards/inspectionCatalogueGlobal.guard` |
| A staged table's name is allow-listed | `services/upstreamImport/tablePolicy.ts` + `transform/ledger.ts#stagedTable` |
| The app role cannot read staging | `migrations/upstreamImportGrants.p2401.live` (as `callibrator_app`) |

---

## 12. What Is Not Done (so nobody reads this as finished)

- **No real upstream data has been loaded.** `UPSTREAM_REAL_DATA_ALLOWED` is false; the legal basis
  and the operator's client contracts (**OA-5**, UD-18) are the owner's. The dry run (P24-05),
  reconciliation (P25), field UAT (P26) and cutover (P30) all wait behind it.
- **The legacy QR sticker is unread.** **OA-4** decides whether a sticker is a bare number or a URL;
  until it is scanned, the legacy resolver (P27-02) and the sticker-scan test (P27-04) are unbuilt.
- **The facility-scope security gate is not green.** `docs/SECURITY/15` § 11 has open rows (G-22,
  G-26 … G-30) and the live twins; the pre-go/no-go review (P17-07) is BLOCKED on them.
- **The field app has not been run on a real phone by a real person** (P26-02; the runbook is the
  owner's).
- **This document is a map, not a second source of truth.** Where it and the code disagree, the code
  is right and this document is a defect — the same rule `docs/` lives by everywhere else.

---

## 13. References

- Decisions: ADR-124 (tenancy and the facility scope), ADR-125 (the catalogue), ADR-126 (the IPM
  record), ADR-127 (the offline PWA), ADR-129 (the SQL-dump import and the transform), ADR-130 (the
  image import), ADR-132 (the register), ADR-133 (calibration dates), ADR-138 (the public page),
  ADR-139 (invitations) — `MEMORY/DECISIONS.md`.
- Research and plans: `docs/UPSTREAM/` (00 … 12); the phase index
  `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`.
- Frontend: `docs/FRONTEND/`, `docs/UPSTREAM/13-USER-GUIDES-ID.md`.
- The existing module reference (modules 1 … 35): [`10-MODULE-REFERENCE.md`](./10-MODULE-REFERENCE.md).
