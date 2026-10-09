# Feature Spec — P19-03 Device Extensions: the QR Code, Type, Inventory Date, Calibration Lab, Accessories, Condition, Rooms, Photos, Serial Duplicates and the QR Lookup

**Written:** 2026-10-08 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-03 (Phase 19, Domain Design). Builds in **P20-02** (device columns, rooms, the calibration-record columns of P19-05), **P20-08** (`attachments.purpose`, the IPM resource type), **P21-02** (API, photo pipeline), **P22-02** (device form and list); consumed by P19-02 (IPM room confirmation, `ipm_interval_months`), P19-05 (quick calibration entry by QR), P19-07 (public page), P19-08 (offline registration and lookup), P21-06 (inventory export reads), P24-02 / P24-03 (import of devices, rooms, photos), P25 (reconciliation)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it)
**Card scope (verbatim):** *"Device extensions spec: `qr_code` normalisation + per-tenant uniqueness, `device_type_id`, `inventoried_on`, `calibration_vendor_id`, `accessories_complete`, condition vocabulary, photos as attachments (`device-photos`), serial duplicates. Also fixes the QR-lookup path (P18-04 A-12/C-11, P18-03 N-13) and the photo routes, and updates their rows in the P18-04 plan."*
**Decision record:** **ADR-132** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-124 § 3, § 5, § 9, security analysis (uniqueness oracles) and Amendments 1 – 2 (the bound contract, the move, rooms G-F4) · ADR-125 Am. 1 § 5 (`device_type_id` RESTRICT, built in 0111) · ADR-126 § 6 (`ipm_interval_months`) · ADR-127 § 1, § 5, § 6 (offline registration, photo capture, QR scan) · ADR-084 Q-02 / migration 0089 (retired is terminal) · A-92 / A-133 (serial reserved after delete; restore) · `MEMORY/specs/P19-01-inspection-catalogue.md` § 4.7 · `P19-04-client-facilities.md` § 5.1, § 5.2, § 9.3, § 11, § 15 · `P18-03-facility-scope-permissions.md` § 5, § 8.2 (A-2, A-3, A-5, A-9), § 8.3 (N-6, N-13), § 14 (OQ-2, UD-10) · `P18-04-two-tenant-two-facility-test-plan.md` A-12, A-13, B-01 … B-04, B-15, C-10, C-11 · `docs/SECURITY/15` FT-49, FT-50, FT-74 … FT-78, FT-90, FT-99, FT-107, § 13.1 (OQ-2) · `docs/UPSTREAM/02-FEATURES.md` F-23 … F-31 · `03-DATABASE.md` § 4.5, Q-12 … Q-20, Q-24, Q-27, Q-28 · `04-SCHEMA-MAPPING.md` § 4.2, § 4.6, § 5, § 8 · `07-DATA-MINIMISATION.md` § 2.3, § 4 · `08-FILE-POLICY.md` § 3, § 4, § 7 · `09-REPORT-LAYOUTS.md` § 3, § 4, § 6, § 7 · `TASKS/PHASE-12-…` § 3 (UD-9 decided; UD-10 working decision 2026-10-08)
**Code read 2026-10-08:** `models/calibrationDevice.model.ts` (no `created_by`; `status` ENUM; paranoid with a `defaultScope` on `is_deleted`), `services/calibrationDevices.service.ts` (`findSerialHolder`, `serialConflict` — "unique per organisation", reserved after delete), `routes/api/calibrationDevices.route.ts` (route order; `validateUuid` on `/:calibrationDeviceId`), `packages/contracts/src/calibrationDevices.ts`, `models/warehouse.model.ts` (no kind, no floor; `code` not unique), `models/attachment.model.ts` (`folder` is the **legacy disk path**, default `uploads/attachments`), `constants/attachmentResources.ts`, `services/attachment.service.ts`, migrations `0026` (serial per tenant), `0089`, `0111`, `0117` (`facility_insert_default('device')` — a device of a multi-facility tenant must name its facility), `0118`, `0123` (`attachments_facility_kind`, `warehouses.client_facility_id`), `migrations/facilityMigration.shared.ts`.

> **Privacy.** No upstream data value appears here. QR examples use the synthetic prefix `TST`; counts are structural (`03` § 4.5).

---

## 1. Problem

The device register is the root of the evidence chain. Upstream identifies a device by its **QR sticker number** (every IPM row points to it), registers it with a type, brand, model, serial, a free-text room and floor, a condition, an accessories flag, an inventory date, a typed calibration date and lab, and two mandatory photos (front, serial plate) (`03` § 4.5, F-23 … F-31). Callibrator's `calibration_devices` has none of the QR, type (now built, 0111), condition, rooms-as-entities, inventory date, lab, accessories or photo semantics. Without a spec three things go wrong: the QR becomes an existence oracle or loses its uniqueness, rooms stay free text the facility scope cannot reach, and photos become anonymous attachments whose "front" or "serial plate" role lives in a file name.

Personas: the **provider technician** (registers devices in any facility, scans stickers), the **facility technician** (bound `HEALTHCARE TECHNICIAN`; registers and edits devices of its facility — UD-4 (b)), the **facility's readers** (the inventory and its export), the **provider administrator** (rooms, labs, moves), the **ETL** (23,722 devices, ~3,099 room pairs, ~47 k photos).

---

## 2. What Is Already Decided (not re-decided here)

| Decision | Source |
|---|---|
| `device_type_id` → `device_types` RESTRICT, index `(device_type_id, tenant_id)`, LEFT include; a retired type cannot be **given** (400) | ADR-125 Am. 1 § 5, Am. 2 § 3; built 0111 (P20-01) |
| QR unique **per tenant** (never global — the oracle trap); serial unique **per facility** `(tenant_id, client_facility_id, serial_number)` | `04` § 4.2; UD-9 (owner, 2026-10-07); ADR-124 security analysis |
| Bound users do **not** set QR codes (provider staff assign them; a collision's 409 names nothing) | OQ-2 working decision (`docs/SECURITY/15` § 13.1); ADR-124 Am. 1 § 9 ("P19-03 finalises") |
| Bound technicians create and edit devices in their own facility; the bound contract drops `clientFacilityId`, QR and status | ADR-124 Am. 1 § 9; P18-03 A-2, A-3; UD-4 (b) (working decision 2026-10-08, ships) |
| Rooms are facility-owned `warehouses` rows after a cleaning pass; a district office's health centres are rooms inside its facility | UD-10 (working decision 2026-10-08); ADR-124 § 3 (G-F4: the CHECK waits for the room kind) |
| `calibration_devices.client_facility_id` NN, composite keys, the per-facility serial swap, `UNIQUE (tenant_id, id)` and `(tenant_id, client_facility_id, id)` | P20-07 (0117 – 0123) |
| A device move: one audited operation, children follow, refused into a non-active facility, for a retired device, with an open IPM draft or an unsigned certificate, or when the serial exists in the target | ADR-124 Am. 2 § 2; P19-04 § 11 |
| Photos: content-sniffed, size and pixel limits, ClamAV, EXIF/GPS stripped from derivatives, HEIC → JPEG derivative, display + thumbnail derivatives; keys `t/<tenant>/f/<facility>/attachments/<uuid>.<ext>` | `08` § 3, § 4, § 7; ADR-124 § 9; P19-04 § 9.3 |
| The QR lookup is facility-accessible (N-13): another facility's or tenant's QR → 404 identical to an unknown one | P18-04 § 4 (gap closed 2026-10-08); PT-31 |
| Photos in an export are fetched through signed, expiring links, never permanent URLs | `09` § 4.3; ADR-128 |
| The external-lab certificate PDFs are archive-only — no certificate file of any kind is stored | owner rule 2026-10-07; `07` § 2.3, § 4.1 |

### Gaps and contradictions found — resolved by ADR-132 (deviation protocol)

| # | What `docs/` says | What is true or missing | Resolution (§) |
|---|---|---|---|
| G-D1 | `02` F-23: QR "normalised to `SKP` + 6 digits" | `SKP` is the upstream provider's own prefix; hard-coding it would make every tenant's stickers look like one company's | normalisation by a pure function with **per-tenant** settings `devices.qrCodePrefix` / `devices.qrCodeDigits` (a bare number is padded with the prefix); the import sets the provider's (§ 4.2) |
| G-D2 | `04` § 4.2: partial unique `(tenant_id, qr_code) WHERE qr_code IS NOT NULL AND deleted_at IS NULL` | the device model filters on `is_deleted` (its `defaultScope`), not `deleted_at`; and the serial precedent (A-92, ADR-078) keeps an identifier **reserved** after a soft delete so a restore (A-133) never collides — a physical sticker stays on the physical device | `UNIQUE (tenant_id, qr_code) WHERE qr_code IS NOT NULL` over every row; the 409 says when the holder is deleted (§ 4.3) |
| G-D3 | `04` § 5: condition `Baik`/`Laik` → `status active`, `Tidak Baik`/`Rusak` → `inactive`; Phase 12 § 3 lists the condition vocabulary as a design question that is ours | `status` is the device's **operational lifecycle** (active / inactive / maintenance / retired — retired terminal, 0089; `maintenance` is IPM's `not_fit_for_use` side effect); the physical condition is a separate observation that changes independently. Folding 323 "not good" devices into `inactive` would take working devices out of service and out of the IPM "due" list | a separate `condition` column (`good`, `not_good`, `broken`); `status` is mapped only for `Rusak` → `inactive` (§ 4.4) |
| G-D4 | `04` § 4.6 / `02` F-25: photos with `folder = device-photos`, imported certificates `folder = certificates-legacy` | `attachments.folder` is the **legacy disk path** (default `uploads/attachments`; storage keys replaced it, P8-01) — overloading it with a meaning would break the migration tool and the legacy reader; the certificate PDFs are archive-only (owner rule) | a new nullable column **`attachments.purpose`** (`device_front`, `device_serial_plate`, `device_other`, `ipm_evidence`) with one live front and one live serial-plate photo per device; `certificates-legacy` dropped (§ 7) |
| G-D5 | `02` F-25: photos mandatory at registration | offline registration (ADR-127 § 7) creates the device, then uploads photos, as separate queued requests; imported devices have 162 missing files (`03` Q-28) | photos are **not** required by the API; `photosComplete` is computed on read and the capture screen requires both before "finish" (§ 7.2) |
| G-D6 | ADR-124 Am. 2 G-F4: `warehouses` gains `client_facility_id` now, "the CHECK waits for UD-10's room kind"; `04` § 4.2: room + floor → one warehouse, floor in `description` | UD-10 is a working decision; `warehouses` has no kind and no floor; today's tenants use warehouses both as stores and as device locations (all with NULL facility after 0123) | `warehouses.kind` (`store` default, `room`) and `floor`; CHECK `kind <> 'room' OR client_facility_id IS NOT NULL`; a **trigger** (not a composite FK — existing devices point at NULL-facility stores) keeps a device's room in its own facility (§ 6) |
| G-D7 | rooms are created by `warehouse` write; upstream technicians type rooms freely during registration and IPM | requiring a provider administrator for every new ward would stall field registration | the device form **finds or creates** a room by `(facility, normalised name, floor)` under `calibration` write, audited (§ 6.3) |
| G-D8 | P18-03 A-9 marks the warehouse reads "only after UD-10"; the bound ceiling's `warehouse` cell waits on UD-10 | rooms are now facility rows; the bound technician's device form needs a room picker | `warehouse` **read** joins the bound ceiling for every bound role; A-9 (`GET /warehouses`, `GET /warehouses/:warehouseId`) **marked** — rooms of the caller's facility only (provider stores have no facility, so the hooks never return them) (§ 6.4) |
| G-D9 | P19-04 § 11.2: the move updates the device's facility | after G-D6 a device's room belongs to its facility; the move would leave it pointing at the old facility's room | the move clears `location_id` or sets `targetLocationId` (a room of the target facility) in the same transaction (§ 9) |
| G-D10 | ADR-124 Am. 2 § 1 (G-F1): an unbound create without a facility defaults to the self facility | the database as built (0117 `facility_insert_default('device')`) defaults only in a tenant with **no** other facility; a multi-facility tenant's create must name it | the unbound create contract requires `clientFacilityId` when the tenant serves any non-self facility (**400** "Choose the client facility this device belongs to."), else defaults to self (§ 8.1) |
| G-D11 | `calibration_devices` has no registrant; `04` § 4.2 maps `id_user` to the CREATE audit row; `07` § 2.3 to "`created_by` / snapshot"; `09` § 4.1 prints the registrant as the technician fallback | an audit row is not a column a list can read for 23 k devices | `created_by` + `registrant_snapshot` (§ 4.1) |
| G-D12 | `02` F-35 / F-23: lookup `GET /calibration-devices?qrCode=` | a list filter answers 200 with an empty list for another facility's QR — fine — but P18-04 C-11 / PT-31 want a single-row lookup whose 404 is identical for unknown, another facility's and another tenant's QR, and the field flow (ADR-127 § 6) resolves one device | `GET /calibration-devices/by-qr/:qrCode`, registered **before** `/:calibrationDeviceId`; the list keeps a `qrCode` filter too (§ 8.2) |

---

## 3. The Model at a Glance

```
calibration_devices (tenant_id, client_facility_id NN, id)                     [P20-07]
  + qr_code             UNIQUE (tenant_id, qr_code) WHERE NOT NULL  — reserved after delete
  + device_type_id      → device_types (GLOBAL) RESTRICT                         [0111, built]
  + inventoried_on, accessories_complete, condition (+ _changed_at, _source)
  + calibration_vendor_id → vendors (provider-internal) SET NULL
  + created_by → users, registrant_snapshot
  + ipm_interval_months (P19-02), client_ref (offline)
  + location_id → warehouses   ─── trigger: a ROOM must be in the device's facility; a STORE is any
  (+ P19-05: next_calibration_date_source, calibration_requested_at / _by_session_id)
warehouses + kind (store | room), floor;  CHECK room ⇒ client_facility_id NOT NULL
attachments + purpose (device_front | device_serial_plate | device_other | ipm_evidence)
            one live front, one live serial plate per device
```

**Aggregate.** The **device** (root of the evidence chain): invariants — its QR unique in the tenant, its serial unique in its facility, its room in its facility, its facility changed only by the move, `retired` terminal (0089). **Room** — a location of one facility. **Photo** — an attachment of the device with a purpose.

---

## 4. `calibration_devices` — New Columns (P20-02)

Conventions as P19-01 § 4; every index, CHECK and key in the migration (ADR-100 Am. 3 — `db.sync()` runs first; the model declares the attributes without indexes); no blanket `try/catch`; each new column nullable or with a constant default, so no table rewrite.

### 4.1 Columns

| Column | Type | Null | Notes |
|---|---|---|---|
| `qr_code` | varchar(32) | NULL | the sticker number, **normalised** (§ 4.2); unique per tenant over every row (§ 4.3); never settable by a bound principal (§ 5) |
| `inventoried_on` | date | NULL | when the device was entered in the register (upstream `tgl_inventory`) — **not** `installation_date` (a different fact); CHECK `inventoried_on >= '1990-01-01'`; the service refuses a date after today in the tenant zone (400) — the import keeps the 8 future and 65 pre-2023 values and lists them (`03` Q-12, Q-13) |
| `accessories_complete` | boolean | NULL | upstream `Ada` → true, `Tidak` → false, NULL → NULL |
| `condition` | ENUM `enum_calibration_devices_condition` = `DEVICE_CONDITIONS` (`good`, `not_good`, `broken`) | NULL | § 4.4; NULL = not assessed |
| `condition_changed_at` | timestamptz | NULL | set by the service whenever `condition` changes |
| `condition_source` | ENUM `DEVICE_CONDITION_SOURCES` (`registration`, `manual`, `import`) | NULL | NN ⇔ `condition` NN (CHECK) |
| `calibration_vendor_id` | uuid → vendors SET NULL | NULL | the device's usual calibration laboratory (upstream `lab_kalibrasi`); loaded **in the caller's context** (a vendor of another tenant → 404 on the vendor); vendors are provider-internal, so for a bound reader the include is NULL (deny per include, AM-5) and the response carries `calibrationVendorDisplay { name }` read through the person/organisation projection (P19-04 § 12 pattern) — the facility sees "calibrated by <lab>", not the provider's vendor record |
| `created_by` | uuid → users RESTRICT | NULL | the registrant (G-D11); NULL on rows created before this migration and on imported rows whose registrant is gone |
| `registrant_snapshot` | jsonb `{ name, role, organisation }` | NULL | taken at create (like `performer_snapshot`, ADR-126 § 1); imported per `07` § 3 ("Former upstream user #<n>" for a deleted registrant); never back-filled for existing rows (the 0103 argument) |
| `ipm_interval_months` | smallint | NULL | ADR-126 § 6: 0 = not under IPM, NULL = the tenant setting; CHECK 0 – 60 (P19-02 § 11) |
| `client_ref` | uuid | NULL | offline registration (ADR-127 § 7); `UNIQUE (tenant_id, created_by, client_ref) WHERE client_ref IS NOT NULL`; resolved in the caller's context (AM-16, as P19-02 § 9.3) |

`device_type_id` exists (0111). `category` stays (the existing filters) and is set from the type's name when a type is given and `category` is empty. The P19-05 columns `next_calibration_date_source`, `calibration_requested_at`, `calibration_requested_by_session_id` land in the same P20-02 migration (P19-05 § 4).

**Indexes:** `calibration_devices_tenant_qr_code_unique` (§ 4.3); `(calibration_vendor_id)`; `(created_by)`; `(tenant_id, condition)`; `calibration_devices_client_ref_unique`. List-order indexes for the new sorts are measured in P21-02, not guessed.

### 4.2 QR normalisation — `normaliseQrCode(input, { prefix, digits })` (contracts, pure, shared with the PWA and the ETL)

1. Trim; remove internal whitespace; upper-case (`[a-z]` → `[A-Z]`).
2. If the result is **only digits** and the tenant has a prefix: `prefix + zero-pad(digits)` — e.g. prefix `TST`, digits 6: `"42"` → `"TST000042"`; more digits than `digits` → **400** "This QR number is longer than <digits> digits." (a typed number never silently loses digits).
3. Accept `^[A-Z0-9][A-Z0-9-]{2,31}$`; else **400** "A QR code holds 3 – 32 letters, digits or hyphens." (upstream values are 9 – 13 characters of `[A-Za-z0-9-]` — every one conforms, `03` § 4.5).
4. Tenant settings `devices.qrCodePrefix` (`^[A-Z]{1,8}$`, unset = no padding) and `devices.qrCodeDigits` (4 – 12, default 6), set by a tenant administrator (existing settings route); read by the service through the reviewed `skipFacilityScope` of P18-03 § 10.2 for bound callers of the lookup.

The same function normalises the lookup path parameter, the create/update body and the ETL's `no_qrcode`, so a sticker scanned, typed or imported resolves to one value. A case-only collision in the import (upstream's collation was case-insensitive) is checked in the dry run and quarantined if found (`qr_case_collision`).

### 4.3 QR uniqueness and its 409 (G-D2; FT-50)

- `UNIQUE (tenant_id, qr_code) WHERE qr_code IS NOT NULL` — every row, soft-deleted and retired included (a sticker is physical; a deleted device restored keeps it, A-133).
- The service pre-checks in the **unbound** caller's context (the only callers who can set a QR, § 5) and answers **409** `DEVICE_QR_TAKEN` "QR code <qr> is already on device <name> in <facility>." / "… on a deleted device (<name>); restore it, or use another sticker." — unbound callers see every facility, so naming discloses nothing beyond their scope. The unique index is the backstop for the race (`SequelizeUniqueConstraintError` on `qr_code` → the same 409, as `isSerialUniqueViolation` does today).
- **Changing** a device's QR (sticker replaced) is an unbound `calibration` write (`PUT`, audited before/after); clearing it is allowed (a device awaiting a sticker).
- *As built (ADR-132 Am. 1 § 1, migration 0128, 2026-10-09):* the database also holds the normalised shape — CHECK `calibration_devices_qr_code_shape` on `QR_CODE_PATTERN` (`@callibrator/contracts/deviceValues`).

### 4.4 Condition (G-D3)

| Value | Upstream `kondisi_alat` | Meaning |
|---|---|---|
| `good` | `Baik` (23,262), `Laik` (135) | physically sound, fit to use |
| `not_good` | `Tidak Baik` (323) | defects observed; still in its place |
| `broken` | `Rusak` (1) | not working |

`Laik` merges into `good` (its raw value stays in `id_map.source_values` for the reconciliation). **Status from the import:** `active`, except `Rusak` → `inactive`; empty → `condition` NULL, `status active`. **Afterwards** condition is set at registration or edited by a `calibration` writer (`condition_source` `registration` / `manual`); an IPM does **not** change it (its effect is the recommendation's — P19-02 § 8.5). The renderer's labels: Baik / Tidak Baik / Rusak (`id.ts`), Good / Not good / Broken (`en.ts`); status tone by shape and icon (ADR-122).

---

## 5. Who May Write What — the Bound and Unbound Device Contracts

| Field | Unbound create / update (`calibration` write) | Bound create / update (HT·b, own facility) |
|---|---|---|
| `clientFacilityId` | create: required in a multi-facility tenant (G-D10), else default self; update: **refused** (400 — the move is the only path, AM-6) | absent (strict → 400); stamped by the hooks |
| `qrCode` | ✔ (§ 4.3) | **absent** (strict → 400) — OQ-2 working decision: provider staff assign stickers; no QR oracle for bound users |
| `status` | ✔ (retired terminal, 0089) | absent (strict → 400 — P18-04 B-03) |
| name, manufacturer, model, serial, type, `inventoriedOn`, `accessoriesComplete`, `condition`, `locationId` / `room`, `installationDate`, `calibrationIntervalDays`, `nextCalibrationDate`, `ipmIntervalMonths`, `calibrationVendorId`, remarks | ✔ | ✔ except `calibrationVendorId` (vendors are provider-internal — absent) |
| `clientRef` (create) | ✔ | ✔ |

Two strict Zod schemas per verb in `@callibrator/contracts` `calibrationDevices.ts` — `createCalibrationDeviceSchema` / `createCalibrationDeviceBoundSchema`, `updateCalibrationDeviceSchema` / `updateCalibrationDeviceBoundSchema` — chosen by the controller from `facilityBound` (the context's, never the body's). A device registered by a bound technician has no QR until provider staff attach one; it is found by name, serial, type or room meanwhile (the capture list). **Serial duplicates** (UD-9): the holder check runs **in the caller's context and the device's facility** (`findSerialHolder(tenantId, clientFacilityId, serial)`), so a bound technician's 409 can only name its own facility's device (FT-49); messages change from "in this organisation" to "**in this facility**" ("Serial numbers are unique per client facility — edit that device, or use a different serial number."). The index swap itself is P20-07's (0118).

---

## 6. Rooms (UD-10; G-D6 … G-D8)

### 6.1 `warehouses` — new columns (P20-02)

| Column | Type | Null | Notes |
|---|---|---|---|
| `kind` | ENUM `enum_warehouses_kind` = `WAREHOUSE_KINDS` (`store`, `room`) | NN, default `store` | every existing row stays a `store` (today's behaviour unchanged) |
| `floor` | varchar(50) | NULL | a room's floor (upstream `lantai`); NULL for stores |

CHECK `warehouses_room_has_facility` `kind <> 'room' OR client_facility_id IS NOT NULL` (the G-F4 CHECK of ADR-124 Am. 2, now possible) · `warehouses_store_no_floor` `kind = 'room' OR floor IS NULL` · UNIQUE `warehouses_room_name_unique` `(tenant_id, client_facility_id, lower(btrim(name)), coalesce(lower(btrim(floor)), '')) WHERE kind = 'room' AND is_deleted = false` (per facility — never global). Rooms are **soft-deletable** like every warehouse (an include of `Warehouse` keeps `required: false` — the first trap; already so in `calibrationDevices.service`).

### 6.2 A device's room stays in its facility — trigger `calibration_devices_location_facility` (BEFORE INSERT OR UPDATE OF `location_id`, `client_facility_id`; ENABLE ALWAYS)

If `NEW.location_id` names a warehouse of kind `room`, its `client_facility_id` must equal `NEW.client_facility_id` (and its tenant the device's); a `store` is accepted for any device of the tenant (a workshop or depot — provider-internal, so a bound reader sees the location as NULL). A composite FK is not used: today's devices point at NULL-facility stores, which a composite FK `(tenant, facility, location)` would refuse. The service checks first and answers **400** "This room belongs to another facility."

*As built (ADR-132 Am. 1 § 2, migration 0128, 2026-10-09):* the trigger also refuses a location of another tenant (any kind) and fires on `tenant_id`; a second trigger, `warehouses_room_devices_facility`, refuses changing a room's facility, kind or tenant while it holds a device of another facility.

### 6.3 Find-or-create a room from the device form (G-D7)

Create and update accept either `locationId` (an existing room or store of the tenant, loaded in context) **or** `room: { name, floor? }`: the service normalises (`trim`, collapse whitespace), looks up a live room of the **device's facility** with that name and floor, and creates one if none exists (`kind room`, code `R-` + a per-tenant sequence, as the ETL — `04` § 4.2), in the device's transaction, audited (`CREATE Warehouse`, operation `CREATE_ROOM_FROM_DEVICE`). Gated by the device route's `calibration` write — so a bound technician can add a room **of its own facility** (stamped by the hooks), never a store. Stock routes refuse a room as a stock location (**400** "Rooms hold devices, not stock."; stock pickers list `kind = 'store'` only) — the "warehouse" vocabulary for a ward is a UI concern: the device and IPM screens say "Room / Ruangan".

### 6.4 Bound access to rooms (G-D8)

- **Bound ceiling** (P18-03 § 5): `warehouse` **read** for every bound role (the cell "F, UD-10" resolved).
- **Marked** (A-9, kind `read`): `GET /api/v1/warehouses` and `GET /api/v1/warehouses/:warehouseId` — the hooks return only rooms of the caller's facility (stores have NULL facility and never match). `GET /warehouses/:warehouseId/locations` stays **unmarked** (storage locations are provider-internal). The list gains a `kind` filter. Two-facility tests B-15 (`warehouse.twoFacility.test.ts`).

### 6.5 Import (UD-10)

One room per distinct normalised `(facility, nama_ruangan, lantai)` after the cleaning pass (~3,099 pairs; trim, case-fold, collapse whitespace, the operator's merge list for obvious variants — reviewed per facility, flagged as a free-text class, `07` § 2.3); district-office centres become rooms of that facility; codes `R-0001…` per tenant; `description` NULL (the floor has its own column — amends `04` § 4.2).

---

## 7. Photos (G-D4, G-D5)

### 7.1 `attachments.purpose` (P20-08)

| Column | Type | Notes |
|---|---|---|
| `purpose` | varchar(32) NULL, CHECK in (`device_front`, `device_serial_plate`, `device_other`, `ipm_evidence`) | `ATTACHMENT_PURPOSES` in contracts |

CHECK `attachments_purpose_resource`: `purpose IS NULL OR (purpose LIKE 'device_%' AND lower(resource_type) IN ('device','calibrationdevice')) OR (purpose = 'ipm_evidence' AND lower(resource_type) = 'inspectionsession')` · UNIQUE `attachments_one_live_device_photo` `(tenant_id, resource_id, purpose) WHERE purpose IN ('device_front','device_serial_plate') AND is_deleted = false` — one live front and one live serial-plate photo per device. The IPM resource type and 0123's widened CHECK/functions are P19-02 § 12 (same migration).

*As built (ADR-132 Am. 1 § 5, migration 0129, 2026-10-09):* the device purposes are listed explicitly (not `LIKE 'device_%'`), plus CHECK `attachments_purpose_values`.

### 7.2 Routes and rules (P21-02)

| Method + path | Gate | Marked | Idempotency-Key | Contract | Two-tenant / two-facility |
|---|---|---|---|---|---|
| `POST /api/v1/calibration-devices/:calibrationDeviceId/photos` (multipart: `file`, `purpose` ∈ `device_front`, `device_serial_plate`, `device_other`) | `calibration` write + `denyPlatformAuthoring`; `enforceStorageQuota()` | ✔ N-6 (HT·b) | ✔ (offline queue, ADR-127 § 7) | `devicePhotoUpload` (`purpose`); the file through the shared upload validation | **A-13** `devicePhotos.twoTenant.test.ts`; **C-10** `devicePhotos.twoFacility.test.ts` |
| `DELETE /api/v1/calibration-devices/:calibrationDeviceId/photos/:attachmentId` | same | ✔ N-6 | — | `devicePhotoParams` (both ids; the attachment must belong to the device — else 404) | A-13; C-10 |

- **Upload** = the device loaded in context (another tenant / facility → 404, nothing stored); the file passes `08` § 3 (magic bytes JPEG/PNG/HEIC, 10 MB, 50 MP, polyglot refusal), ClamAV fail-closed (`08` § 5), stored under `t/<tenant>/f/<facility>/attachments/<uuid>.<ext>`, derivatives display + thumbnail with EXIF/GPS stripped and HEIC → JPEG (`08` § 4.1). The attachment's facility is stamped **from the device** (FT-25; the AM-7 trigger checks it at commit).
- **Replace** (F-28): uploading a `device_front` / `device_serial_plate` when a live one exists soft-deletes the old one and inserts the new in **one transaction** (the partial unique index is the backstop); the old file is purged by the existing sweep after its grace period (ADR-083). Audited `UPDATE CalibrationDevice` operation `REPLACE_DEVICE_PHOTO` + the attachment rows.
- **Delete** of a device photo is a soft delete, audited; allowed (a register photo is not Part 11 evidence). An `ipm_evidence` photo follows P19-02 § 10.2 (frozen after submit).
- **`photosComplete`** (computed on device reads): a live `device_front` **and** `device_serial_plate` exist. The capture screen requires both before "finish"; the API does not (G-D5). Device lists expose `frontPhotoAttachmentId` / `serialPlatePhotoAttachmentId` (ids only); the frontend asks for a signed thumbnail link per visible row (`POST /attachments/:id/signed-url`, A-6, TTL capped — ADR-128) — **no permanent URL anywhere** (`09` § 4.3 fixes D4's public photo links).
- The generic `POST /attachments` keeps working for device documents (F-32, unchanged), with its bound gate (A-5): for a bound principal only `device` + a purpose, or `inspectionsession` (P19-02).

---

## 8. Device Routes — Changes and the QR Lookup

### 8.1 Create and update (existing routes; P21-02)

`POST /calibration-devices` and `PUT /calibration-devices/:calibrationDeviceId` keep their gates (`calibration` write; marked A-2/A-3 for HT·b), switch to `validate(schema, { from })` with the two schema pairs of § 5, honour `Idempotency-Key` (create — P19-02 § 9.2) and `clientRef` (create). Create rules: G-D10 facility; the type (active — retired → 400, P19-01 § 4.7); QR (§ 4.3); serial (§ 5); room (§ 6.3); `created_by` and `registrant_snapshot` from the principal; `condition_source = registration`. Update: `clientFacilityId` refused (400 "Move the device instead."); a QR change audited before/after. The device's facility `ended` → **409** `IPM_FACILITY_ENDED`-style `DEVICE_FACILITY_ENDED` "<facility> has ended; new records cannot be added." (create; also the 0117 trigger).

### 8.2 The QR lookup (G-D12; N-13, A-12, C-11)

| Method + path | Gate | Marked | Contract | Answer |
|---|---|---|---|---|
| `GET /api/v1/calibration-devices/by-qr/:qrCode` — **registered before** `GET /:calibrationDeviceId` (the shadowing the route index of P19-04 § 7.7 resolves) | `calibration` read (any-of `["calibration", "ipm"]` — a bound `ROOM USER` scanning a sticker to see a device's IPM history holds `calibration` read through `equipment` anyway) | ✔ N-13, kind `read`, every bound role | `deviceQrParams` (`qrCode` 1 – 64 raw characters; normalised by § 4.2 with the tenant's settings) | **200** the device (the `GET /:id` shape, plus `ipmDue`, `calibrationDue`, `photosComplete`, `openIpmDraftId` of the caller if any); **404** "No device with this QR code." — **identical** body for unknown, deleted, another facility's (bound caller) and another tenant's QR (PT-31); a malformed value after normalisation → **400** (id-independent: it carries no existence information) |

The lookup runs **in the caller's context** (FT-107); it never loads unscoped and compares (AM-17). Rate limit: the authenticated API's default budget (no special path — it is an ordinary read). `GET /calibration-devices` keeps a `qrCode` filter (normalised) for lists.

### 8.3 Device reads — additions (P21-02; the inventory export reads of P21-06 read the same)

Rows gain: `qrCode`, `deviceTypeId` + `deviceType { id, name }` (LEFT include), `inventoriedOn`, `accessoriesComplete`, `condition`, `conditionChangedAt`, `location { id, name, floor, kind }` (LEFT; NULL for a bound reader when it is a store), `calibrationVendorDisplay`, `registrantDisplay` (snapshot), `photosComplete`, the two photo ids, `ipmDue` (P19-02 § 11), `calibrationDue` and `lastCalibration` (P19-05 § 6), `clientFacility { id, name, code }` for unbound readers (P19-04 § 13.1). Filters: `qrCode`, `deviceTypeId`, `condition`, `locationId`, `floor`, `clientFacilityId` (convenience for unbound), `photosComplete`, `ipmDue`, `calibrationDue`, `inventoriedFrom/To`; sorts end in `id`; `limit` ≤ 200. No `legacyId` anywhere (FT-104).

*As built (ADR-132 Am. 2, P21-02a, 2026-10-09):* the card is split — P21-02a built § 4.2, § 4.3, § 5, § 6.3, § 6.4, § 8 and `?view=field`; the photo routes of § 7.2 are **P21-02b** (TODO). Deviations: the bound create keeps `clientFacilityId` (its own facility, another one the 404 — P21-09e's answer); the edit refuses only a CHANGE of facility; the settings are `device_qr_code_prefix` / `device_qr_code_digits`; a room created on the fly is coded `R-<8 hex of its id>` and a concurrent duplicate is 409 `ROOM_CREATED_CONCURRENTLY`; the reads' facts are model reads per page (no raw SQL); `?ipmDue=` is `GET /ipm/due`'s; the working set's cap is a 400 `FIELD_WORKING_SET_TOO_LARGE`; `GET /warehouses` lists both kinds unless `kind` is given (the frontend's stock screens send `kind=store`).

---

## 9. The Device Move — What This Card Adds (G-D9)

`POST /calibration-devices/:calibrationDeviceId/move` (P19-04 § 11.2) gains an optional `targetLocationId` (a room **of the target facility**, loaded in context — 404 otherwise; a store of the tenant is also accepted). In the move transaction, **before** the facility update: `location_id := targetLocationId` (or NULL when the current location is a room of the old facility and no target is given); the § 6.2 trigger then holds the result. The QR moves with the device (unique per tenant — nothing to check); the serial check in the target is P19-04's; photos follow as attachments (P19-04 § 9.4 re-key). Audit: the two move rows (P19-04 § 16) carry `location: { from, to }`. `P19-04` § 11.2 is amended with a pointer here.

---

## 10. Import (P24-02, P24-03) — What the ETL Must Write

| Upstream | Target | Rule |
|---|---|---|
| `no_qrcode` | `qr_code` | `normaliseQrCode` with the provider tenant's settings (`devices.qrCodePrefix` set by the operator before the load — never hard-coded); case collision → quarantine `qr_case_collision` |
| `id_alat` | `device_type_id`, `category` | via `id_map('mst_alat')` (5 merged groups) |
| `sn` | `serial_number` | placeholders → NULL (`03` Q-17); duplicates **inside one facility** (624 groups): the oldest device keeps it, the others NULL, the original in `id_map.source_values`, listed in the per-facility data-quality report (UD-9) |
| `nama_ruangan`, `lantai` | `location_id` → a room (§ 6.5) | |
| `kondisi_alat` | `condition` (+ `status` only for `Rusak`) | § 4.4; `condition_source import` |
| `aksesoris` | `accessories_complete` | |
| `lab_kalibrasi` | `calibration_vendor_id` | one `vendors` row (`type CalibrationLab`) per distinct value per tenant (10 values) |
| `tgl_inventory` | `inventoried_on` | future / pre-2023 values kept and reported (Q-12, Q-13) |
| `tgl_kalibrasi` | **not a device column** | UD-8 interim rule: kept in `id_map.source_values`; P19-05 § 9 |
| `id_user` | `created_by` (the imported user) else NULL; `registrant_snapshot` | `07` § 3 pseudonym for a deleted registrant (2,294 orphans, Q-3) |
| `foto_depan`, `foto_sn` | attachments `purpose device_front` / `device_serial_plate` | P24-03 from P24-07's manifest; host stripped (Q-27); 162 missing files → device listed `photosComplete = false`; keys with the facility segment |
| `id_client` | `client_facility_id` | via `id_map('mst_faskes')` (P19-04 § 15); never inferred |
| — | `ipm_interval_months` NULL | the provider tenant's `ipm.intervalMonths = 1` applies (ADR-126 § 6) |

One audit row per imported device and room (UD-13), actor `system:upstream-import`, `changes` `{ source, legacy_table, legacy_id }` only. Reconciliation (P25): counts per facility, QR set equality, serial-NULL list = the reported duplicates, room count per facility, photo pairs per device (RC-F3 for keys).

---

## 11. Audit Events

| Act | `action` | `resourceType` | `changes.operation` | `changes` also carries |
|---|---|---|---|---|
| device create / update (existing rows, extended) | `CREATE` / `UPDATE` | `CalibrationDevice` | (existing) | before/after of every changed field incl. `qrCode`, `condition`, `locationId`, `deviceTypeId` — the registrant snapshot by key only |
| room created from the device form | `CREATE` | `Warehouse` | `CREATE_ROOM_FROM_DEVICE` | device id, facility |
| photo upload / replace / delete | `CREATE` / `UPDATE` / `DELETE` | `Attachment` (+ `UPDATE CalibrationDevice` `REPLACE_DEVICE_PHOTO` on a replace) | `UPLOAD_DEVICE_PHOTO`, `REPLACE_DEVICE_PHOTO`, `DELETE_DEVICE_PHOTO` | purpose, attachment ids, size, SHA-256 — never the original file name |
| QR settings change | `UPDATE` | `TenantSettings` | (existing settings audit) | key, before/after |

Every row inside its transaction, stamped with the device's facility.

---

## 12. Security (P17-06 cross-reference)

- **Oracles:** QR unique per tenant but **never writable by a bound principal** → a bound user can provoke no QR 409 (FT-50 closed, not merely accepted); serial per facility and checked in context (FT-49); a room name unique per facility; the lookup's 404 identical across unknown / other facility / other tenant (PT-31).
- **Facility from the context:** the bound contracts have no `clientFacilityId`; an unbound update cannot change it (400, plus the AM-6 hooks and the 0118 guard trigger); a room of another facility is refused by the service and the § 6.2 trigger.
- **Files:** every photo through `08`'s ingest; facility segment in the key; signed links only after the in-context load, TTL capped (ADR-128); no permanent link in an export (FT-72).
- **Provider-internal leaks through includes:** vendor and store includes are NULL for bound readers (deny per include, AM-5); the lab's name reaches them only through the display projection.
- **P17-06 should note:** the room find-or-create lets a bound technician create rows in a tenant table (`warehouses`, facility-stamped, `kind room` only) — bounded by the per-facility unique name and audited.

---

## 13. Test Plan — Mapped to the P18-04 Plan and the Gate Rows

**Contracts:** `qrCode.normalise.test.ts` (trim, spaces, case, bare number padded with the prefix, too many digits 400, pattern 400, no prefix → digits kept as typed, idempotent: `normalise(normalise(x)) = normalise(x)`); `calibrationDevices.bound.contract.test.ts` (the bound schemas refuse `clientFacilityId`, `client_facility_id`, `qrCode`, `status`, `calibrationVendorId` — strict 400; P18-04 B-03/B-04).

**Backend (memoryDb):**
- `calibrationDevices.qr.p2102.test.ts` — create/update with a taken QR (live, deleted) → 409 with the holder named for an unbound caller; the unique-index race → the same 409; clearing a QR; a QR change audited.
- `calibrationDevices.serialFacility.p2102.test.ts` — the same serial in F1 and F2 accepted; a duplicate in F1 → 409 "in this facility"; a bound F1 technician's 409 names only F1's device (FT-49).
- `calibrationDevices.facilityRequired.p2102.test.ts` — G-D10: single-facility tenant defaults to self; multi-facility tenant without `clientFacilityId` → 400; update with `clientFacilityId` → 400.
- `deviceRooms.p2102.test.ts` — find-or-create by name + floor (one room, not two); a room of F2 for an F1 device → 400; a store accepted; stock refuses a room; a bound HT creates a room only in F1.
- `deviceQrLookup.twoTenant.test.ts` (**A-12**, `@two-tenant`) and `deviceQrLookup.twoFacility.test.ts` (**C-11**, `@two-facility`: F2's QR, another tenant's QR, an unknown QR and a deleted device's QR → bodies identical; route registered before `/:id` — a parity case in `facilityRouteIndex.parity.test.ts`).
- `devicePhotos.twoTenant.test.ts` (**A-13**) and `devicePhotos.twoFacility.test.ts` (**C-10**: F2's device / photo → 404=, nothing stored — storage and row counts compared).
- `devicePhotos.p2102.test.ts` — replace keeps one live front photo; delete; `photosComplete`; purpose/resource CHECK mirrored by the contract (`ipm_evidence` on a device → 400); an infected file refused (ClamAV double); HEIC → JPEG derivative; EXIF stripped from derivatives.
- `calibrationDevices.twoFacility.test.ts` (**B-01 … B-04**, with the new fields and filters: a foreign `clientFacilityId` filter → empty).
- `warehouse.twoFacility.test.ts` (**B-15**, now marked: F2's room 404=, stores never listed for bound).
- `calibrationDevice.condition.p2102.test.ts` — `condition_source`, `condition_changed_at`; the import mapping table of § 4.4 (pure transform test, synthetic).
- `deviceMove.location.p2109.test.ts` — the move clears a room of the old facility or sets `targetLocationId`; a target room of another facility → 404.
- Guards: `facilityAccessibleRoutes.guard` (A-9, N-6, N-13 entries; a planted QR-update marker for bound fails — there is no bound QR path), `boundCeilingRoutes.guard` (G-P3: the `warehouse` read ceiling has its marked reads), `twoTenantRoutes.guard`, `twoFacilityRoutes.guard`, `routePermissionGuard.p604`, `pageOrderTiebreaker.ci3`, `modelIndexColumns.am3`, D-26 (the new ENUMs), D-27 (`registrant_snapshot` shape), `includeRequired.d12` (vendor, location, type includes LEFT).

**PostgreSQL 18 as `callibrator_app` (`*.live.test.ts`, P20-02/08; G-25):** the QR unique over deleted rows; the room CHECKs and the per-facility room name unique; the § 6.2 trigger (room of another facility refused, store accepted, for the owner too); the photo purpose CHECK and the one-live-photo unique; an **upgrade boot** from the image before P20-02 with seeded devices and warehouses (every existing warehouse `store`, every existing device unchanged).

**Live (P21-10, P22-02):** API smoke of every new and changed route; an E2E spec registering a device with a room created on the fly and two photos, scanning its QR, replacing the front photo, and the inventory list showing the thumbnail through a signed link.

**Privacy:** synthetic fixtures only (QR `TST000001`, "Room 1", "Facility One").

---

## 14. Threat-Model Rows Addressed

FT-49 (serial per facility, in context) · FT-50 (**closed**: bound users never write a QR) · FT-72, FT-74 … FT-78 (photos through the ingest, signed links capped, keys with the facility) · FT-90 (the working-set read is the device list under the hooks) · FT-99 (import facility from the device row) · FT-104 (no legacy id in a response) · FT-107 (lookup in context) · AM-5 (vendor/store includes) · AM-6 (no facility change by update) · AM-7 (photos' facility from the device) · AM-17 (no load-then-compare). OQ-2 **finalised** (`docs/SECURITY/15` § 13.1 updated).

## 15. Traps Checked

| Trap | Here |
|---|---|
| optional include without `required: false` | type, location (warehouse — has a `defaultScope`), vendor, creator: every include LEFT |
| include of a model with a `defaultScope` | `Warehouse` and `Vendor` are paranoid → `required: false` pinned by `includeRequired.d12` |
| `is_deleted` in code | the room unique index names the **column** `is_deleted` in SQL only; services use `isDeleted` |
| model index on a migration-added column | none: every new index in P20-02 / P20-08 |
| global uniqueness oracle | QR per tenant, serial per facility, room per facility |
| `schema.validate` / unseen path parameter | `validate(schema, { from: ["params", "body"] })` on the photo and lookup routes |
| blanket `try/catch` in a migration | none |
| named export beside `export =` | models alone; contracts named |

## 16. Decisions Made Here (recorded as ADR-132)

1. QR normalised by a shared pure function with per-tenant prefix and digit settings (G-D1); unique per tenant over every row, reserved after delete (G-D2); bound principals never set or change it (OQ-2 finalised).
2. `GET /calibration-devices/by-qr/:qrCode` before `/:id`, marked, 404 identical across scopes (G-D12).
3. A separate `condition` column; status mapped only for `Rusak` (G-D3).
4. `attachments.purpose` with one live front and serial-plate photo per device; `folder` left alone; `certificates-legacy` dropped (G-D4); photos not API-mandatory, `photosComplete` computed (G-D5).
5. Rooms = `warehouses` `kind room` + `floor`, facility required; a trigger keeps a device's room in its facility (G-D6); find-or-create from the device form (G-D7); `warehouse` read in the bound ceiling and A-9 marked (G-D8).
6. The move clears or re-targets the room (G-D9).
7. A multi-facility tenant's unbound create names its facility (G-D10).
8. `created_by` + `registrant_snapshot`; `client_ref`; `ipm_interval_months` (G-D11).

**For the owner / SME (none blocks the migration):** whether `Laik` should stay distinct from `Baik` (recommended merged — § 4.4); the provider's QR prefix to configure (an operator setting at onboarding, OA-8's moment).
