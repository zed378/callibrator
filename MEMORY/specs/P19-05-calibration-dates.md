# Feature Spec — P19-05 Calibration Dates: the Quick External-Calibration Entry by QR, History Kept, the Next Due Date From the Latest Effective Record, "Calibration Due", and the Import Actor

**Written:** 2026-10-08 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-05 (Phase 19, Domain Design). Builds in **P20-02** (the calibration-record and device columns, in the device-extension migration), **P21-05** (the quick entry, the due-date maintenance), **P21-04** (the IPM `needs_calibration` flag), **P21-06** (recap reads), **P22-05** (quick entry and list), **P24-04** (the import key), **P24-02** (the calibration transform); consumed by P19-02 (device snapshot dates), P19-06 (IPM report "Tanggal Kalibrasi"), P23-04 (recaps), P25 (reconciliation)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it)
**Card scope (verbatim):** *"Calibration-date spec: quick external calibration record by QR, history kept, import actor (per-tenant import API key, 04 § 4.7)."*
**Decision record:** **ADR-133** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-062 and migration 0057 (append-only, correct/void), migration 0105 (`calibration_records_actor_exactly_one`, Q-51 — an API key as the recording actor), ADR-094 (an API key is a system actor), ADR-124 § 9 and Am. 2 § 7 (people shown by snapshot), ADR-126 § 6, § 8 (due computed at read; exports rendered in the frontend), ADR-128 · UD-8 (working decision 2026-10-08: only `trx_kalibrasi` rows become records; no `next_calibration_date` on imported devices; the meaning of `trx_inventory.tgl_kalibrasi` is **OA-7**, owner/SME fact) · UD-7 (`Asia/Jakarta`; OA-6) · UD-17 (`needs_calibration` → a scheduler flag) · owner rule 2026-10-07 (external-lab certificate PDFs archive-only; no certificate file stored) · `MEMORY/specs/P19-02-ipm-session-aggregate.md` § 8 · `P19-03-device-extensions.md` § 4, § 8.2 · `P19-04-client-facilities.md` § 12, § 15 · `P18-01-02-role-matrix-and-grants.md` § 3.2, § 4.3 (UD-4 (b); record void narrowed) · `P18-03-facility-scope-permissions.md` § 8.3 N-10 · `P18-04-two-tenant-two-facility-test-plan.md` A-14, C-14 · `docs/SECURITY/15` FT-99 … FT-104, AM-27, AM-28 · `docs/UPSTREAM/02-FEATURES.md` F-62 … F-64, F-68, F-69 · `03-DATABASE.md` § 4.5, Q-9 … Q-14 · `04-SCHEMA-MAPPING.md` § 4.2, § 4.7 · `07-DATA-MINIMISATION.md` § 2.3, § 3, § 4.1 · `09-REPORT-LAYOUTS.md` § 2.4 (L-1), § 4
**Code read 2026-10-08:** `services/calibrationRecords.service.ts` (`createCalibrationRecord` sets `device.nextCalibrationDate = calibrationDate + calibrationIntervalDays` on **every** create; `correctCalibrationRecord` and `voidCalibrationRecord` never touch it), `models/calibrationRecord.model.ts` (paranoid; `defaultScope` on `is_deleted`; `performedBy` XOR `apiKeyId`; `dueDate`), `models/calibrationDevice.model.ts` (`nextCalibrationDate`, `calibrationIntervalDays`, `recommendedCalibrationInterval`), `services/calibrationScheduler.service.ts` (`buildDueWhere`: `nextCalibrationDate <= threshold`; one open auto-scheduled Preventative work order per device, 0060), `routes/api/calibrationRecords.route.ts`, `packages/contracts/src/calibrationRecords.ts`, `calibrationDevices.ts` (`nextCalibrationDate` settable directly), migrations `0057`, `0105`, `0119` (0057's function replaced: every column added later is immutable after insert), `models/apiKey.model.ts` (`scopes`, `expiresAt`, `isActive`), `constants/systemActors.ts`.

> **Privacy.** No upstream data value appears here. Counts are structural (`03` § 4.5, § 7).

---

## 1. Problem

Upstream records a device's calibration date by scanning its QR, confirming the room and typing the date; it **upserts one row per device**, overwriting the date and the technician (`IpmController::kalibrasiSave`, `03` § 4.5; 110 devices kept two rows only because they predate the upsert). It also has a second, unexplained date typed at registration (`trx_inventory.tgl_kalibrasi`), which differs from the recorded one on 2,173 of 3,640 devices (`03` Q-11) — its meaning is OA-7. Callibrator records calibrations as append-only records (ADR-062), but:

1. there is no **quick** path for "this device was calibrated by an outside laboratory on this date" — the full form expects results, uncertainty and a standard;
2. the device's **next due date moves backward** when an older record is entered after a newer one (the create sets it from whichever record arrives last), and **never moves** on a correction or a void — both defects of today's code;
3. imported history needs an **actor**: the upstream technician may be gone, and `calibration_records_actor_exactly_one` (0105) requires a user or an API key;
4. the recaps (`09` § 4.2) need per-record facts the table lacks — the room at the time and who entered it — and a "latest per device" read.

Personas: the **provider technician** (unbound; enters dates in the field after an external lab's visit — `calibration` write, UD-4 (b)), the **facility's readers** (see dates and status; bound users do not enter them, N-10), the **provider administrator**, the **ETL** (3,640 rows), the **recap renderer**.

---

## 2. What Is Already Decided (not re-decided here)

| Decision | Source |
|---|---|
| Calibration records are append-only for every role; a correction is a new record superseding the original; a void names a reason and is final; every column added later is immutable after insert | ADR-062; 0057; 0119 |
| Exactly one recording actor per record: `performed_by` (a user) **or** `api_key_id` (a key) | 0105, Q-51 |
| Voiding a calibration record needs `rbac([TENANT_ADMIN])` once technicians hold `calibration` write | P18-01-02 § 4.3 (UD-4 (b), ships with P20-06) |
| Technicians (`TECHNICIAN`, `HEALTHCARE TECHNICIAN`) get `calibration` write in every tenant | UD-4 (b) |
| Quick calibration-date entry is **provider (laboratory) work** — not facility-accessible | P18-03 N-10 |
| Only `trx_kalibrasi` rows become records; imported devices get **no** `next_calibration_date` until the SME answers OA-7; the meaning of `tgl_kalibrasi` changes only P24-02's mapping | UD-8 (working decision 2026-10-08) |
| `needs_calibration` on an IPM → a scheduler flag, audited in the submit transaction | UD-17; P19-02 § 8 |
| Imported upstream dates at 00:00 `Asia/Jakarta` unless OA-6 shows otherwise | UD-7 |
| No certificate file of any kind is kept in storage for the import; external-lab PDFs archive-only; an optional later data-entry pass records the latest certificate's key data per device | owner rule 2026-10-07; `07` § 2.3, § 4.1 (F-CERT, option A now, C later) |
| Exports rendered in the browser from paginated reads; the recaps are one parametrised recap (`dateField`, `from`, `to`, `latestOnly`) | ADR-126 § 8; `09` § 4.3 |
| People shown by snapshot where one exists, else a redacting projection; no **back-fill** of a snapshot onto `calibration_records` | ADR-124 Am. 2 § 7 (G-F5) |

### Gaps and contradictions found — resolved by ADR-133 (deviation protocol)

| # | What `docs/` / code says | What is true or missing | Resolution (§) |
|---|---|---|---|
| G-C1 | `calibrationRecords.service#createCalibrationRecord`: `nextCalibrationDate = this record's calibrationDate + interval` | entering an **older** record after a newer one moves the due date **backward** — a device calibrated last month becomes "overdue" because last year's certificate was typed in today | the next due date is **derived from the device's latest effective record** (§ 5), recomputed on create, correction and void |
| G-C2 | the same service: a correction or a void leaves `nextCalibrationDate` untouched | voiding the record that set the due date leaves a due date no record supports; a corrected date leaves the old due date | recompute on correction and void (§ 5); behaviour change for every tenant, a defect fix with a fail-before test |
| G-C3 | `02` F-62: "optional certificate attachment" with the quick entry | the owner rule keeps no certificate file; the certificate's **key data** is what the record needs (number, laboratory, verdict, next due date as stated) | the quick entry records the key data and **takes no file** (§ 4.1); the existing generic attachment path is unchanged |
| G-C4 | ADR-124 Am. 2 § 7: "No snapshot column is added to `calibration_records`"; `07` § 3: imported calibration dates keep a performer snapshot ("Former upstream user #<n>" for a gone user) | the amendment rejected a **back-fill** (it would need the trigger disabled and would record today's names as then); a record cannot carry `07` § 3's attribution without a column, and neither can a new external entry show who entered it to a bound reader without an unscoped user read | `performer_snapshot` **written at insert only**, never back-filled; rows before the migration keep the projection of P19-04 § 12 (narrows Am. 2 § 7, its reasoning kept) (§ 4.1) |
| G-C5 | `04` § 4.7: every imported record's actor is the import API key, "provider technicians are in another tenant (§ 3)" | under ADR-124 the provider's technicians are users **of the same tenant**; recording a resolvable person as a key loses attribution | `performed_by` = the imported user when the upstream user maps to one; the **import key only** for the 1,235 NULL users and the deleted ones (§ 9) |
| G-C6 | `07` § 2.3: `trx_kalibrasi.nama_ruangan` → "record's room snapshot"; `04` § 4.7: into `notes` | `notes` is free text the recap cannot read as a room; `09` § 4.2 notes the upstream recap printed the device's **current** room, not the room confirmed at calibration | `room_snapshot` / `floor_snapshot` columns (§ 4.1) |
| G-C7 | `02` F-62: the quick entry is `POST /calibration-records` with `standard: external lab` | that overloads `standard` (the reference standard) with "who did it", and the full contract invites results the lab never gave | `entry_kind` (`full_record`, `external_date`) and its own narrow route on the device (§ 4, § 7) |
| G-C8 | UD-17's "scheduler flag" has no column; the scan reads `next_calibration_date` only | a flag that edits `next_calibration_date` would destroy the date the certificate stated | `calibration_requested_at` / `calibration_requested_by_session_id` on the device; "calibration due" reads both; the scan includes flagged devices; a later effective record clears it (§ 6) |
| G-C9 | `09` § 4.1 D4: "Tanggal Kalibrasi" falls back to the inventory date, unmarked | a silent substitution of one date for another | the recap prints the latest calibration date or nothing, and the inventory date in its own column (§ 8) |

---

## 3. The Model at a Glance

```
calibration_devices
  next_calibration_date            (existing)   ← derived from the latest EFFECTIVE record (§ 5), or set by hand
  + next_calibration_date_source   ENUM manual | record                         [P20-02]
  calibration_interval_days        (existing)
  + calibration_requested_at, calibration_requested_by_session_id → inspection_sessions (id)   [P20-02]
calibration_records (append-only, 0057/0119)
  + entry_kind           ENUM full_record | external_date      NN, default full_record   [P20-02]
  + calibration_vendor_id → vendors SET NULL,  external_lab_name varchar(255)   (the lab, as recorded)
  + room_snapshot, floor_snapshot                                                (at insert)
  + performer_snapshot jsonb                                                     (at insert; never back-filled)
  performed_by XOR api_key_id (0105)   — the import key for imported rows with no resolvable person
"effective record" = is_deleted = false AND superseded_by_id IS NULL
```

---

## 4. Columns (P20-02 — the same migration as the P19-03 device columns)

All nullable or with a constant default (no rewrite); all immutable after insert on `calibration_records` by the existing trigger (every column added later — 0057/0119). Indexes and CHECKs in the migration only.

### 4.1 `calibration_records`

| Column | Type | Null | Notes |
|---|---|---|---|
| `entry_kind` | ENUM `enum_calibration_records_entry_kind` = `CALIBRATION_ENTRY_KINDS` (`full_record`, `external_date`) | NN, default `full_record` | `full_record` = recorded with the full calibration form (every existing row — the honest meaning of what they are); `external_date` = an outside laboratory's calibration recorded by its date and key data (G-C7) |
| `calibration_vendor_id` | uuid → vendors SET NULL | NULL | the laboratory that performed it (a `vendors` row of type `CalibrationLab`, loaded in context) |
| `external_lab_name` | varchar(255) | NULL | the laboratory's name **as recorded** (from the vendor at entry, or typed when it is not a vendor) — the record stays readable when the vendor row changes or to a bound reader (vendors are provider-internal) |
| `room_snapshot`, `floor_snapshot` | varchar(255), varchar(50) | NULL | the room confirmed at entry (G-C6); imported: `nama_ruangan` (a free-text class, flagged for the facility's review, `07` § 2.3) |
| `performer_snapshot` | jsonb `{ name, role, organisation, source? }` | NULL | **at insert only** (G-C4): the entering user as P19-02 § 4.1; an imported row: the upstream person's name or "Former upstream user #<n>" (`07` § 3), with `source: "upstream-import"` (only imported rows carry `source`); never written to logs or `audit_logs.changes`; D-27 shape `CalibrationRecord.performerSnapshot` |

CHECKs: `calibration_records_external_has_lab` `entry_kind <> 'external_date' OR external_lab_name IS NOT NULL OR api_key_id IS NOT NULL OR performer_snapshot->>'source' = 'upstream-import'` (an imported date with no recorded laboratory is allowed — the upstream recorded the lab per device, not per calibration; § 9) · `calibration_records_external_no_results` `entry_kind <> 'external_date' OR (results IS NULL AND measurement_uncertainty IS NULL AND standard IS NULL)`. Indexes: `(calibration_vendor_id)` (D-20); **partial** `calibration_records_effective_device` `(tenant_id, device_id, calibration_date DESC, created_at DESC, id) WHERE is_deleted = false AND superseded_by_id IS NULL` (the "latest effective" read — measured against 0109's live index in P21-05; if 0109's already serves it, this one is not added, recorded).

### 4.2 `calibration_devices`

| Column | Type | Null | Notes |
|---|---|---|---|
| `next_calibration_date_source` | ENUM `NEXT_CALIBRATION_DATE_SOURCES` (`manual`, `record`) | NULL | NULL ⇔ `next_calibration_date` NULL (CHECK); `manual` when set through the device form, `record` when derived (§ 5) |
| `calibration_requested_at` | timestamptz | NULL | the IPM `needs_calibration` flag (G-C8) |
| `calibration_requested_by_session_id` | uuid → `inspection_sessions (id)` RESTRICT | NULL | NN ⇔ `calibration_requested_at` NN (CHECK); single-column key (no facility in it, so the device move's cascade has one path — P19-04 § 5.1); the session is the device's (service; trigger `calibration_devices_request_same_device` refuses another device's session) |

Existing rows: `next_calibration_date_source` = `manual` where `next_calibration_date` is set (the migration's one set-based UPDATE — `calibration_devices` is not append-only), else NULL.

*As built (ADR-133 Am. 1, migration 0128, 2026-10-09):* a trigger `calibration_devices_next_date_source` fills the source (`manual` when a date is written without one, NULL without a date) until P21-05's writers name it; `calibration_records_external_has_lab` compares `coalesce(performer_snapshot->>'source', '')` (the literal predicate passed on NULL); `calibration_records_effective_device` is left to P21-05's measurement.

---

## 5. The Next Due Date — One Rule, Applied on Create, Correction and Void (G-C1, G-C2)

`deriveNextCalibrationDate(device, latestEffective)` (contracts, pure):

1. No effective record → **leave** `next_calibration_date` and its source unchanged if the source is `manual`; if the source is `record` (the record that set it was voided or corrected away), set it to the **latest remaining effective record's** derivation, or to NULL with source NULL when none remains (the device page then says "no calibration on record — set the next due date by hand").
2. Latest effective record = max by `calibration_date`, then `created_at`, then `id`, among the device's records with `is_deleted = false AND superseded_by_id IS NULL`.
3. If that record carries a `due_date` (the date the certificate states) → that date, source `record`.
4. Else if the device has `calibration_interval_days` → `calibration_date + interval`, source `record`.
5. Else → unchanged (a device with no interval and no stated due date keeps any manual date).

**Where:** `calibrationRecords.service` create, correct and void — and the new quick entry — call it inside their transaction after the record write, under `SELECT … FROM calibration_devices WHERE id = $device FOR UPDATE` (two concurrent entries for one device serialise on the device row). The device update is audited (`UPDATE CalibrationDevice`, operation `DERIVE_NEXT_CALIBRATION_DATE`, from/to) only when the value changes. A later **manual** edit through `PUT /calibration-devices/:id` sets source `manual` and wins until the next record. Changing `calibration_interval_days` (device form, or `predictive-maintenance` approving a recommended interval) re-derives when the source is `record`.

**Behaviour change for every tenant** (deliberate, a defect fix): an older record no longer moves the date backward; a correction or a void now moves it. The P21-05 record states it with the fail-before tests of § 12.

---

## 6. "Calibration Due" — Computed at Read

`computeCalibrationDue({ status, nextCalibrationDate, requestedAt, today, timeZone, dueSoonDays })` (contracts):

| Device | `state` |
|---|---|
| `retired`, `inactive`, or deleted | `not_scheduled` |
| `calibration_requested_at` set | `requested` (by IPM visit n — with the session id) — wins over the date |
| no `next_calibration_date` | `not_scheduled` |
| `next_calibration_date` < today (tenant zone) | `overdue` |
| ≤ today + `dueSoonDays` (tenant setting `calibration.dueSoonDays`, default 30) | `due_soon` |
| otherwise | `ok` |

- Device reads gain `calibrationDue { state, nextCalibrationDate, source, requestedBySessionId? }` and `lastCalibration { date, entryKind, performerDisplay, externalLabName }` (the latest effective record); `GET /calibration-devices` gains the filter `calibrationDue` (`overdue`, `due_soon`, `requested`). Implemented, like P19-02's "due", as one batched `sql()` per page with the tenant predicate bound and `facilityClause('d.client_facility_id', n)` (the device list is marked A-1), on the partial index of § 4.1; listed for `rawSqlTenantPredicate.d05`'s facility twin; proved by `rawSqlFacility.live.test.ts`.
- **The scan** (`calibrationScheduler.service#buildDueWhere`, P21-04) becomes `next_calibration_date <= threshold OR calibration_requested_at IS NOT NULL`; the work order it opens for a requested device says "Calibration requested by IPM visit <n>"; 0060's "one open auto-scheduled order per device" still holds.
- **Clearing the request:** a new **effective** record of the device with `calibration_date >= calibration_requested_at::date` (any entry kind) clears both columns in its transaction (audited `IPM_CALIBRATION_REQUEST_CLEARED`, actor the entrant); P19-02 § 8.3 / § 8.4 clear it when its chain is voided or corrected away from `needs_calibration`.
- **Imported devices** (UD-8 interim): the import sets neither `calibration_interval_days` nor `due_date`, so § 5 derives nothing and the scan never reminds — exactly the interim rule, with no special case in the code.

---

## 7. The Quick External-Calibration Entry (F-62; P21-05, P22-05)

### 7.1 Flow

Scan or type the QR → `GET /calibration-devices/by-qr/:qrCode` (P19-03 § 8.2) shows the device, its last calibration, its room → the technician confirms or changes the room, enters the calibration date, picks the laboratory (the device's `calibration_vendor_id` pre-selected) or types it, optionally the certificate number, the date the certificate gives for the next calibration, and the laboratory's verdict → **save**. History is kept: every save is a new record; nothing is overwritten (the upstream upsert is not ported).

### 7.2 Route

| Method + path | Gate | Marked | Idempotency-Key | Contract (`@callibrator/contracts` `calibrationRecords.ts`) | Two-tenant |
|---|---|---|---|---|---|
| `POST /api/v1/calibration-devices/:calibrationDeviceId/calibration-dates` | `auth, dynamicAccess("calibration", "write"), denyPlatformAuthoring, validate(calibrationDateEntry, { from: ["params", "body"] })` — **API keys allowed** (as `POST /calibration-records`, Q-51: a laboratory's system may post dates; the key becomes `api_key_id`) | **no** (N-10: bound → 403-route, C-14) | ✔ (P19-02 § 9.2) | `calibrationDateEntry` (strict): `calibrationDate` (`YYYY-MM-DD`), `calibrationVendorId?` (uuid), `externalLabName?` (1 – 255; required when no vendor), `certificateNumber?` (≤ 100), `dueDate?` (`YYYY-MM-DD`, the certificate's stated next date), `isCompliant?` (the laboratory's verdict: true / false / omitted = not stated), `locationId?` or `room?` (P19-03 § 6.3), `notes?` (≤ 2000) | **A-14** `calibrationDates.twoTenant.test.ts` |

### 7.3 Rules and answers

| Condition | Answer |
|---|---|
| device not found in context (another tenant; deleted) | **404** identical to a random id |
| device `retired` | **409** `CALIBRATION_DEVICE_RETIRED` "This device was retired on <date>; a calibration cannot be recorded. A tenant administrator can reinstate it." |
| the device's facility `ended` | **409** `CALIBRATION_FACILITY_ENDED` "<facility> has ended; new records cannot be added." (and the 0119/0117 insert trigger) |
| `calibrationDate` after today (tenant zone) | **400** "A calibration date cannot be in the future." |
| `calibrationDate` before 1990-01-01 | **400** |
| `dueDate` not after `calibrationDate` | **400** "The next calibration date must be after the calibration date." |
| neither `calibrationVendorId` nor `externalLabName` (a person entering) | **400** "Name the laboratory that calibrated the device." |
| `calibrationVendorId` not a vendor of the tenant (in context) | **404** on the vendor (another tenant's id is not found) |
| a room of another facility | **400** "This room belongs to another facility." (P19-03 § 6.2) |
| an effective record of the device with the **same** `calibrationDate` and entry kind `external_date` exists | **201** still (two calibrations on one day are possible) — the response carries `notices: ["A calibration on this date is already recorded (by <name>)."]`; the PWA/form shows it before saving (a soft duplicate warning, not a 409: history is never refused) |
| ok | **201** the record (`entry_kind external_date`, `performed_by` = the user or `api_key_id` = the key, `performer_snapshot`, `room_snapshot`/`floor_snapshot`, `external_lab_name` from the vendor or the body) + the device's derived `nextCalibrationDate` (§ 5) + the cleared request (§ 6), all in one transaction; the device's room updated when changed (audited) |

`calibration_date` is stored as 00:00 of that day in the tenant's zone (the column is `timestamptz`, `DataTypes.DATE`); reads present it as a date. Corrections and voids of a quick-entry record use the existing routes (`POST /calibration-records/:id/corrections` — technicians; `/void` — `rbac([TENANT_ADMIN])` after P20-06) — no new path, the same lifecycle (ADR-062).

### 7.4 What the quick entry does not do

It stores **no file** (G-C3): no certificate PDF is uploaded through it; the certificate's number, laboratory, stated next date and verdict are the record. The existing generic attachment upload against a device or a record is unchanged (F-32, not this card's scope). It issues no certificate of ours (a certificate is a laboratory's own document; issuing stays with the full record and the certificate pipeline). It is not offline-capable in this group (ADR-127 § 1 limits offline to lookup, registration and IPM capture).

*As built (ADR-133 Am. 2, P21-05, 2026-10-09):* § 5 runs in `calibrationDates.service#rederiveNextCalibrationDate` (create, correction — both devices —, void, quick entry, an interval change of a `record` date) and names the source explicitly; the 0128 source trigger stays as a backstop for raw writers. `calibration_records_effective_device` is **not** added: measured on PG 18 over 20,000 records, the per-device read is an index scan on 0119's index (≈ 0.1 ms) and a 200-device page a bitmap scan on `calibration_records_device_id` (≈ 2 ms). § 6's facts and the `calibrationDue` filter are model reads per page and a `where` on the device's columns (tenant zone's days), not a batched `sql()`. A correction keeps its record's kind, laboratory and snapshots, and cannot add results to an external date (400). Every new full record writes `performer_snapshot`. The request is cleared by a record dated on or after the request's day in the tenant's zone.

---

## 8. Reads for the Recaps and Lists (P21-06; `09` § 4)

`GET /api/v1/calibration-records` (marked A-4 for bound readers) gains, in `getCalibrationRecordsQuery`:

| Parameter | Meaning |
|---|---|
| `dateField` | `calibration` (default) \| `created` (the input date — "harian" / "rentang input") |
| `from`, `to` | inclusive dates in the tenant zone |
| `latestOnly` | one row per device — its latest **effective** record (F-63, F-69) |
| `entryKind` | `full_record` \| `external_date` |
| `clientFacilityId` | convenience for unbound callers (a foreign value returns an empty list for a bound one) |
| `deviceId`, `qrCode` | |
| `sort` | `calibrationDate` \| `createdAt`, ending in `id`; `page`, `limit` ≤ 200 |

Each row carries, besides the record: `device { id, name, manufacturer, model, qrCode, serialNumber }`, `room { name, floor }` (**the snapshot**, falling back to "—", never to the device's current room — `09` § 4.2's defect), `clientFacility { name }` for unbound readers, `performerDisplay` (the snapshot; the P19-04 § 12 projection for rows older than the migration), `externalLabName`, `entryKind`, `effective`. `latestOnly` is one `sql()` with `DISTINCT ON (device_id)` over the partial index, the tenant predicate bound and `facilityClause('r.client_facility_id', n)` (G-14 live twin). The browser builds the four upstream recaps from this one read (`09` § 4.3): daily = `dateField=created&from=to=day`; by calibration date; the two ranges. Inventory XLSX "Tanggal Kalibrasi" = the device read's `lastCalibration.date`, **never** the inventory date (G-C9); "Teknisi Pelaksana" = `lastCalibration.performerDisplay`, else the device's `registrantDisplay` labelled as the registrant.

*As built (ADR-133 Am. 3, P21-06, 2026-10-09):* the days are **`fromDay` / `toDay`** (inclusive, the tenant's zone) beside the existing `from` / `to` instants, both on the `dateField` column; `latestOnly` picks each device's latest effective record **within** the filters (one `sql()` with DISTINCT ON, the tenant bound, `facilityClause`; the rows then read through the models); a QR out of view is an empty page; `clientFacility { id, name, code }` for provider staff only; the room is `{ name, floor }` from the snapshot with "—". The `clientFacilityId` filter is ANDed beside the facility hook (it was replaced by it — on the device list too). Tests: `routes/calibrationRecords.recap.p2106.test.ts`, `routes/exportReads.twoFacility.test.ts` (G-22), live `services/calibrationRecap.p2106.live.test.ts`.

---

## 9. Import (P24-02, P24-04) — the Calibration Transform and Its Actor (G-C5)

### 9.1 `trx_kalibrasi` → `calibration_records`

| Upstream | Target | Rule |
|---|---|---|
| `id` | new uuid; `id_map('trx_kalibrasi')` | |
| `id_inventory` | `device_id` (+ `tenant_id`; `client_facility_id` from the device by the 0119 default trigger) | via `id_map('trx_inventory')`; no device → quarantine `no_device` |
| `tanggal_kalibrasi` | `calibration_date` | 00:00 in the zone of UD-7 (default `Asia/Jakarta`; OA-6 before the dry run); a **future** date (after the dump) → quarantine `future_calibration_date` (an append-only row cannot be fixed by `UPDATE`) |
| `id_user` | `performed_by` = the imported user when it maps to one; **else** `api_key_id` = the import key | 1,235 NULL (`03` Q-10) and the deleted users get the key; `performer_snapshot` = the person's name, or "Former upstream user #<n>" (`07` § 3), or `{ name: null, role: "import", organisation: <tenant> }` for a NULL user |
| `nama_ruangan` | `room_snapshot` | free-text class, flagged for the facility's review |
| — | `entry_kind external_date`; `results`, `standard`, `measurement_uncertainty`, `is_compliant`, `certificate_number`, `due_date` NULL | upstream holds no measurements and no lab per calibration — **no laboratory is inferred** from the device's `lab_kalibrasi` (`external_lab_name` NULL; the CHECK admits it because the actor is the key or the import) |
| `created_at` | `created_at` | the input date for the "rentang input" recap |
| two rows of one device (110, Q-9) | both kept, ordered by date — history | |

`trx_inventory.tgl_kalibrasi` is **not** imported as a record (UD-8); its value stays in `id_map.source_values` so that OA-7's answer changes only P24-02's mapping (it may become an `external_date` record of its own, or a `manual` next date). After the load, § 5 derives nothing for imported devices (no interval, no stated due date) — the interim rule holds by construction.

**No laboratory is invented for an imported row:** imported rows carry `performer_snapshot.source = "upstream-import"`, and the CHECK of § 4.1 admits an `external_date` row without a laboratory only for those rows or for a key-recorded row; a filler text such as "(not recorded upstream)" was rejected (it would read as data). A person entering through the API always names a laboratory (the contract's 400).

### 9.2 The per-tenant import key (P24-04)

- An `api_keys` row in the **provider tenant**, created by the operator through the existing key route at the start of the load (`rbac([TENANT_ADMIN])`, audited), name `upstream-import`, scopes `calibration: write` only, `expiresAt` = the planned sign-off date + 90 days (UD-18 (a)'s window), revoked (`isActive false`) at cutover (P30) — a P30 runbook check (FT-101).
- It is the **recording actor** of the imported rows that have no resolvable person (`api_key_id`), so 0105's CHECK holds and the trail says "recorded by the import", not by a person who did not do it.
- The audit row of every imported record (UD-13) names `system:upstream-import` (`SYSTEM_ACTORS`, added by P24-02) with `changes { source: "skp_ipm", legacy_table, legacy_id }`.
- The ETL writes through the calibration-record **service** functions with that actor (never a bulk `INSERT` around them), so § 5 and the audit run as for any record; the key is never used over HTTP by the ETL.

> **As built (P24-04, ADR-133 Am. 4, 2026-10-10):** the key is provisioned by `services/upstreamImport/importKey.ts#provisionImportKey`, **not** through the key route — its secret is discarded at creation, so it cannot be used over HTTP at all; the name `upstream-import` is reserved (the key route refuses it). A NULL upstream user's snapshot is `{ name: "Upstream import", role: "import", organisation: <tenant> }` (§ 9.1's `name: null` fails the D-27 shape). A mapped user not found in the tenant is a 409 `IMPORT_PERFORMER_NOT_FOUND`, never the key. A run declared real is refused while `UPSTREAM_REAL_DATA_ALLOWED` is off. Revocation at cutover: `revokeImportKeys`, checked by `importKeyRevoked`.

---

## 10. Audit Events

| Act | `action` | `resourceType` | `changes.operation` | `changes` also carries |
|---|---|---|---|---|
| quick entry | `CREATE` | `CalibrationRecord` | `RECORD_EXTERNAL_CALIBRATION` | device id, calibration date, `entryKind`, vendor id or lab-name length, certificate number present (boolean), `dueDate` |
| next date derived | `UPDATE` | `CalibrationDevice` | `DERIVE_NEXT_CALIBRATION_DATE` | from/to, source, the record id that drove it |
| request cleared | `UPDATE` | `CalibrationDevice` | `IPM_CALIBRATION_REQUEST_CLEARED` | session id, record id |
| room changed at entry | `UPDATE` | `CalibrationDevice` | `CALIBRATION_ENTRY_ROOM` | from/to location ids |
| import key created / revoked | (existing API-key audit rows) | `ApiKey` | | |
| imported record | `CREATE` | `CalibrationRecord` | (import) | `{ source, legacy_table, legacy_id }` only |

Corrections and voids keep their existing rows (`calibrationRecords.service`), now followed by the derive row when the date moves.

---

## 11. Security (P17-06 cross-reference)

- **Not facility-accessible** (N-10): the quick entry route is unmarked → a bound principal gets 403 `FACILITY_ROUTE_REFUSED` before parameters are read (G-10); facility staff read dates through the marked device and record reads.
- **Context:** device and vendor loaded in context (404 across tenants); `performed_by` / `api_key_id` from the principal, never the body (Q-51); the record's facility from its device (0119 trigger).
- **No new oracle:** no new uniqueness; the duplicate-date notice names a person only to a caller who can already read that record.
- **The import key** reads every facility of the provider tenant (an API key is unbound — OQ-11); scoped to `calibration: write`, expiring, revoked at cutover (FT-101).
- **Raw SQL:** the two `sql()` reads (§ 6, § 8) bind the tenant and the context's facility; live twins (G-14).

---

## 12. Test Plan — Mapped to the P18-04 Plan and the Gate Rows

**Contracts:** `calibrationDates.contract.test.ts` (strict body; date formats; lab required for a person; `dueDate` after `calibrationDate`); `nextCalibrationDate.derive.test.ts` (§ 5 table: older record does not move the date back; stated due date wins over the interval; void of the deriving record falls back to the previous one, then to NULL; manual source untouched when no record); `calibrationDue.test.ts` (§ 6 table; zone boundary; requested wins).

**Backend (memoryDb):**
- `calibrationRecords.nextDate.p2105.test.ts` — **fail-before** (recorded by P21-05): today's create of an older record moves the date backward, and a void leaves it — both asserted against the old behaviour first; then the fixed behaviour on create, correction, void, interval change.
- `calibrationDates.p2105.test.ts` — § 7.3 row by row with each code and message; the key path (`api_key_id`, snapshot); the request cleared; the room changed; one transaction (a forced failure after the audit write leaves no record, no device change, no audit row).
- `calibrationDates.twoTenant.test.ts` (**A-14**, `@two-tenant`: T2 → 404=, nothing written).
- `calibrationDates.bound.test.ts` (**C-14** / G-10: a bound HT holding `calibration` write → 403-route, identical for valid and invalid ids).
- `calibrationRecords.recapReads.p2106.test.ts` — the `dateField`/`latestOnly`/`entryKind` filters; the room snapshot printed, never the current room; `exportReads.twoFacility.test.ts` (G-22) extended with `latestOnly` (F1 only).
- `calibrationScheduler.requested.p2104.test.ts` — the scan picks a requested device with no due date; the 0060 index still allows one open order.
- `performerDisplay.calibration.test.ts` (G-24): new rows from the snapshot; pre-migration rows from the projection; a bound reader sees another facility's author redacted (P19-04 § 12).
- Guards: `routePermissionGuard.p604`, `twoTenantRoutes.guard`, `facilityAccessibleRoutes.guard` (no marker on the quick entry), `stateUnions.p905` (the new tuples), D-26, D-27 (`performerSnapshot` shape), `rawSqlTenantPredicate.d05` (the two statements listed with `facilityClause`).

**PostgreSQL 18 as `callibrator_app` (P20-02; G-25):** the new record columns are immutable after insert (the 0119 function — an `UPDATE` of `entry_kind`, `room_snapshot`, `performer_snapshot` refused, also for the owner); the two CHECKs; the request columns' CHECK and same-device trigger; the source back-fill (`manual` where a date existed); an upgrade boot from the image before P20-02 with seeded records; `rawSqlFacility.live.test.ts` for the `latestOnly` and due reads.

**Live (P21-10, P22-05):** API smoke; an E2E spec — scan a QR, record an external calibration, see the next due date derived, enter an older one and see it unchanged, void the newer one as an administrator and see it fall back.

**Privacy:** synthetic fixtures only ("Lab A", QR `TST000001`).

---

## 13. Threat-Model Rows and AM-n Addressed

G-10 (quick entry unmarked), G-14 (two `sql()` reads with the facility clause), G-22 (recap reads), G-24 (performer display from the new snapshot), G-25 (immutability of the new columns), G-29/G-30 (import: no facility inference, reconciliation counts per facility), G-31 (existing calibration suites green — except the deliberate § 5 behaviour change, re-baselined with its record) · FT-99 (the record's facility from the device), FT-101 (the import key), FT-102/AM-28 (`id_map` keeps the facility decided), FT-104 (no legacy id in a response) · AM-17 (device and vendor loaded in context).

## 14. Traps Checked

| Trap | Here |
|---|---|
| optional include without `required: false` | record → device, vendor (paranoid), performer, api key: LEFT; the device's last-calibration read is a batched query, not an include |
| include of a model with a `defaultScope` | `CalibrationRecord` has one (`is_deleted`) — the device-side reads use the batched `sql()`; any include of records keeps `required: false` |
| `is_deleted` in code | only in the SQL of the partial index and the `sql()` reads (column names); services use `isDeleted` |
| an append-only column back-filled | none: `performer_snapshot` and the snapshots are written at insert; `entry_kind`'s default is DDL (no row is updated) |
| model index on a migration-added column | none |
| blanket `try/catch` in a migration | none |
| `schema.validate` / unseen path parameter | `validate(calibrationDateEntry, { from: ["params", "body"] })` |

## 15. Decisions Made Here (recorded as ADR-133)

1. The next due date is derived from the latest effective record on create, correction and void; a stated due date wins over the interval; source tracked (G-C1, G-C2).
2. `entry_kind` and a narrow quick-entry route on the device; no file; the laboratory recorded by vendor and by name (G-C3, G-C7).
3. `performer_snapshot` at insert, never back-filled (narrows ADR-124 Am. 2 § 7; G-C4); room snapshots (G-C6).
4. Imported calibration dates name the person when resolvable, the per-tenant import key otherwise; no laboratory inferred; future dates quarantined; `tgl_kalibrasi` stays in `id_map` (G-C5; UD-8).
5. "Calibration due" computed at read, with the IPM request flag on the device, cleared by a later effective record (G-C8).
6. One recap read (`dateField`, `latestOnly`, `entryKind`); the inventory date never substitutes the calibration date (G-C9).

**For the owner / SME:** OA-7 (the meaning of the typed registration date and the interval) — changes only P24-02's mapping; whether imported devices should get a default calibration interval once OA-7 is answered (recommended: per device type, by the provider, after UAT — not now).
