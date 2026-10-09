# P21-02a: the device register API — QR codes, the bound contract, rooms, the reads' facts, the QR lookup, the field working set

**Date:** 2026-10-09 · **Task:** P21-02a (Phase 21; P21-02 split into a/b, ADR-132 Am. 2 § 1) · **Decision:** ADR-132 Amendment 2 · **Specs:** [`P19-03`](../specs/P19-03-device-extensions.md) § 4.2 – § 8 (as-built note added); [`P19-08`](../specs/P19-08-offline-field-capture.md) § 7.2 · **Base commit:** `71ddf27` · **Built with:** P21-05 (same tree, [record](./2026-10-09-p21-05-calibration-dates.md))

> **Privacy:** synthetic fixtures only (QR prefix `TST`, "Ruang 1", "Lab Sintetis", "Facility One"). `mozivid/` was not touched. `FACILITY_BINDING_ENABLED` stays OFF.

## Built

| Area | What |
|---|---|
| Contracts | `deviceValues`: `normaliseQrCode` (trim, no spaces, upper case, a bare number padded with the tenant's prefix to its digits; 400 messages; idempotent), `QR_CODE_PREFIX_PATTERN`, `QR_CODE_DIGITS_*`, `DEVICE_CONFLICT_CODES`, `FIELD_DEVICE_SUMMARY_KEYS`, `FIELD_WORKING_SET_*`. `calibrationDevices`: the register fields (`qrCode`, `inventoriedOn`, `accessoriesComplete`, `condition`, `calibrationVendorId`, `ipmIntervalMonths`, `room`, `clientRef`), `locationId` XOR `room`, the strict **bound** schemas (no QR, status, vendor, unknown keys), `deviceQrParams`, the list's filters, `view`, `sort`, `limit` ≤ 200, `dayText`. `warehouse`: `kind` filter |
| Routes | `GET /calibration-devices/by-qr/:qrCode` (before `/:id`, marked N-13); `POST /` and `PUT /:id` validated by `validateScoped` (new, validation.middleware: the contract by the principal's binding), `POST /` honours `Idempotency-Key` |
| Services | `deviceRegister.service` (QR normalisation + `qrConflict` 409 `DEVICE_QR_TAKEN` naming holder and facility / "deleted device"; the race → same 409; `resolveLocation`: room found or created by name + floor in the device's facility, audited `CREATE_ROOM_FROM_DEVICE`, coded `R-<8 hex of its id>`, a concurrent duplicate 409 `ROOM_CREATED_CONCURRENTLY`, another facility's room 400, a location out of context 404; `loadVendor` in context; `personSnapshotOf`; `assertNotFuture`). `deviceReads.service` (the facts per page through the models: `ipmDue`, `lastIpm`, the caller's `openIpmDraftId`, `photosComplete` + the two photo ids, `calibrationDue`, `lastCalibration`; `labNames` — reviewed skip; `presentDevice` strips the vendor id/row, `createdBy`, the raw snapshot for a bound reader; `fieldSummary`). `deviceSettings.service` (5 keys, reviewed skip). `calibrationDevices.service`: create/update rules (QR, vendor, inventory date, room, condition source `registration`/`manual`, registrant + snapshot, `clientRef` replay 200, `DEVICE_FACILITY_ENDED`, the facility unchangeable by an edit, `manual` date source), the list's filters and `view=field` with the cap (400 `FIELD_WORKING_SET_TOO_LARGE`), `fetchCalibrationDeviceByQr`. Stock writes refuse a room (400); `GET /warehouses` `kind` |
| Model | `CalibrationDevice` associations `calibrationVendor` (Vendor) and `creator` (User), `constraints: false` (keys are 0128's); every include `required: false` |
| Lists | `FACILITY_ACCESSIBLE_ROUTES` (+3: `GET /by-qr/:qrCode`; `GET /warehouses`, `GET /warehouses/:warehouseId` — A-9), `FACILITY_SCOPE_SKIPS` (+2: `deviceSettingsOf`, `labNames`), tenant-admin settings (+4 incl. P21-05's, a new pattern check), D-24 (+5 reviewed), G-16 readers (+2), the G-P2 pending `/dashboard/warehouses` cleared |
| Frontend | `warehouse.service#getAll` sends `kind=store` (the warehouse and stock screens list stores, as before rooms existed); `schema.d.ts` regenerated |

## What surprised me (→ ADR-132 Am. 2)

1. **No image library exists in the backend**, and HEIC decoding needs a libheif-enabled build — the photo pipeline is its own card (P21-02b) with its own dependency record.
2. **The spec's strict 400 for a bound `clientFacilityId`** would change P21-09e's tested A-2 answer (404 for another facility) for no gain — kept.
3. **memoryDb refuses raw SQL**, so the spec's batched `sql()` for the facts would have needed a query double in every device route suite; model reads per page are hooked (the facility scope for free) and need no G-14 twin.
4. **A QR typed as a bare number is a 400 in a tenant without a prefix** (2 digits < 3 characters) — the 400 is id-independent, so the lookup's 404 stays identical across tenants (tested with full stickers).
5. **`personSnapshotOf` before the device lookup touched the `Role` table for a foreign probe** (the two-tenant suite's "nothing changes" dump caught it): the snapshot is now read only after the device is found.

## Evidence — tests named

- **Contracts:** `test/deviceValues.p2102.test.ts` (normalisation incl. idempotence; the bound schemas' strict refusals; `locationId` XOR `room`; register fields; list query; field keys; P21-05's derivation and due — shared file).
- **memoryDb (real chains, models, hooks):** `routes/calibrationDevices.register.p2102.test.ts` (32: QR normalised/409 named/deleted/400/race on create and edit/cleared and audited/blank; bound strict 400 ×4 on create and edit, bound room in F1, bound foreign location 404; facility unchangeable, `DEVICE_FACILITY_ENDED`; rooms one-not-two, literal match, floor, F2's room 400, store, 404, concurrent 409; stock refuses a room; `kind` filter; inventory date; vendor in context; condition source; registrant; `clientRef` replay/key 400/collision 409; `Idempotency-Key` replay; a holder with no facility; the service's own bound status check; a replay gone from view 404), `routes/calibrationDevices.reads.p2102.test.ts` (12: facts and displays for staff and a bound reader, provider-only keys stripped, projection fallback, filters, `calibrationDue` filter, `view=field` exact keys F1 only, the cap, the QR lookup 200/identical 404s/400, an API key's list), `routes/deviceRegister.isolation.p2102.test.ts` (`@two-tenant` by-qr + calibration-dates; `@two-facility` by-qr + `GET /warehouses/:warehouseId` + the room list), `services/deviceSettings.p2102.test.ts` (16).
- **Re-based legacy assertions (behaviour changed on purpose):** `validators/calibrationDevices.validator.test.js` (limit ≤ 200), `controllers/calibrationDevices.controller.test.js` (the reader's id passed), `services/calibrationDevices.service.test.js` (every include LEFT; the read mocks), `services/calibrationDevices.tokenLeak.a29.test.js` (a list row is the presented object), `services/calibrationDevices.audit.a133.test.js` (mocks only). Guards updated: `facilityContextSource.guard` (G-16), `unboundedFindAll.d24`, `menuEffectiveAccess.bound` (G-P2), `denyPlatformAuthoring.a127` (P21-05's route).
- **Live, PostgreSQL 18, as `callibrator_app`:** `services/deviceRegister.p2105.live.test.ts` (shared with P21-05): a device with a QR and a room found-or-created (room row, QR shape, location trigger, `manual`), the lookup, the QR 409.

## Gates

See the P21-05 record — one quiet tree, one run for both cards.

## Not done / open

- **P21-02b:** the photo routes (`POST/DELETE …/photos`), the ingest (sniffing, ClamAV, EXIF strip, HEIC → JPEG, thumbnails), the image library choice; A-13 / C-10 tests.
- The facts' sessions read loads every effective session of a page's devices; replace with a LATERAL `sql()` if P21-10's smoke measures it slow.
- `?ipmDue=` stays `GET /ipm/due`'s; a `month` parameter is P21-07's.
- P22-02 (device form/list) waits on P21-02b for photos and thumbnails; the stock screens' `kind=store` is in.
