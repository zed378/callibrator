# P21-05: calibration dates — the quick external entry (no file), the next due date from the latest effective record (G-11), "calibration due"

**Date:** 2026-10-09 · **Task:** P21-05 (Phase 21; one card) · **Decision:** ADR-133 Amendment 2 · **Spec:** [`P19-05`](../specs/P19-05-calibration-dates.md) § 4 – § 7, § 10, § 12 (as-built note added) · **Fixes:** BACKLOG G-11 · **Base commit:** `71ddf27` · **Built with:** P21-02a (same tree, [record](./2026-10-09-p21-02a-device-register-api.md))

> **OA-7 is the owner's open question** (what the upstream's typed registration date means). This card builds the spec's working rule (UD-8): a record's `calibration_date` is the day the laboratory calibrated; nothing is derived for a device with no interval and no stated due date. **Privacy:** synthetic fixtures only. `mozivid/` was not touched.

> **Behaviour change for every tenant (release note):** the first record written after the release re-derives the device's next date from its latest effective record. An older certificate typed in no longer moves the date backward; a void or a correction of the record that set it now moves it (to the previous record, or clears it).

## Built

| Area | What |
|---|---|
| Contracts | `deviceValues`: `deriveNextCalibrationDate` (spec § 5), `computeCalibrationDue` + `CALIBRATION_DUE_STATES` / `_FILTERS` / `_SOON_DAYS_DEFAULT`, `calibrationDueWindow`, `zonedDayNumber`, `zonedDayStart`. `calibrationRecords`: `calibrationDateEntry` (strict; due date after the date; one location) |
| Derivation (`services/calibrationDates.service.ts`) | `rederiveNextCalibrationDate`: after the record write, in its transaction, the device locked `FOR UPDATE`; the latest effective record (not voided, not superseded; date, creation, id); the source named explicitly; `DERIVE_NEXT_CALIBRATION_DATE` audited only on a change; a new record dated on/after an IPM request's day (tenant zone) clears it (`IPM_CALIBRATION_REQUEST_CLEARED`). Called by `calibrationRecords.service` create (replacing "this record + interval"), correction (both devices when the device changes) and void, by the quick entry, and by the device edit when the interval of a `record` date changes |
| Quick entry | `POST /calibration-devices/:calibrationDeviceId/calibration-dates` — `calibration` write, `denyPlatformAuthoring`, `validate(calibrationDateEntry, { from: ["params", "body"] })`, `Idempotency-Key`; API keys allowed (`api_key_id`, may omit the laboratory); unmarked (N-10). 201: `external_date` record, the vendor's name or the typed one, the room confirmed (found or created; `CALIBRATION_ENTRY_ROOM`), `room_snapshot`/`floor_snapshot`, `performer_snapshot`, 00:00 of the tenant zone's day; the derived date; `notices` for a same-day entry. 404 / 409 `CALIBRATION_DEVICE_RETIRED` / 409 `CALIBRATION_FACILITY_ENDED` / 400s (future, before 1990, due not after, no laboratory for a person, another facility's room) / 404 vendor |
| Records | every new full record writes `performer_snapshot`; a correction keeps the original's kind, laboratory and snapshots and cannot add results to an external date (400) |
| Due | `calibrationDue` + `lastCalibration` on device reads (P21-02a's `deviceReads`); `?calibrationDue=overdue|due_soon|requested` (tenant zone's days); `calibration_due_soon_days` setting; the device form writes `manual` explicitly |
| Scan | `calibrationScheduler.buildDueWhere` includes `calibration_requested_at IS NOT NULL`; such a device with no date is "Calibration requested", not overdue |

## Decisions (ADR-133 Am. 2)

- **The 0128 source trigger stays** as a backstop for raw writers (ETL, scripts); every service writer now names the source.
- **`calibration_records_effective_device` is not added — measured** (`deviceRegister.p2105.live`, PG 18, 20,000 records / 2,000 devices, 2026-10-09): per-device latest = Index Scan on 0119's `calibration_records_tenant_facility_device`, 16 buffers, **0.10 – 0.12 ms**; a 200-device page (literal id list) = Bitmap Index Scan on `calibration_records_device_id`, 50 buffers, **1.9 ms**.

## Evidence — tests named

- **Fail-before (G-11):** `services/calibrationRecords.nextDate.p2105.test.ts` run against `71ddf27`'s service: **8 of 9 failed** (no source; an older record moved the date back to 2026-01-01; the stated due date lost to the interval; the void left the voided record's date ×2; the correction left the original's; no re-derivation on an interval change; no audit row). After: 9 / 9.
- **Contracts:** `test/deviceValues.p2102.test.ts` (derivation table, due table incl. the Jakarta day boundary, the list window, `calibrationDateEntry`).
- **memoryDb:** `routes/calibrationDates.p2105.test.ts` (16: § 7.3 row by row with codes and messages, the key path, the request cleared, the room changed, a key's entry then a person's notice, one transaction on a failing audit insert, the bound 403 before parameters (C-14) identical for valid/invalid ids, `Idempotency-Key` replay, a correction of an external date), `services/calibrationScheduler.requested.p2105.test.ts` (4), `routes/deviceRegister.isolation.p2102.test.ts` (A-14 `@two-tenant`).
- **Re-based legacy assertions (G-11's behaviour change):** `services/calibrationRecords.service.test.js` ("re-derive … in the transaction" replaces "update nextCalibrationDate from this record"), `services/calibrationRecords.audit.a41.test.js` (the derivation doubled in the record's transaction — its rollback cases still cover the device), `services/calibrationScheduler.service.test.js` (the `Op.or` where).
- **Live, PostgreSQL 18, as `callibrator_app`:** `services/deviceRegister.p2105.live.test.ts` (new `p2105`, 4): the register's writes (P21-02a), the quick entry against the external CHECKs with `record`, a same-day notice, G-11 on the real schema (older record keeps the date; the void's lifecycle UPDATE falls back), the measurement above.

## Gates (2026-10-09; one quiet tree, both cards)

- **Lint:** `node scripts/ci/eslint-ratchet.js`: 0 errors, 0 warnings, baseline 0. Contracts `npm run lint` clean (after removing three needless assertions it found in `zonedDayStart`).
- **Typecheck:** `npm run typecheck`: 0 errors in the backend, contracts and frontend. **Ratchet:** 695 `.js` files, at the floor.
- **Build / load:** `build:dist` OK (733 TypeScript files plus 61 in contracts); `load:check` OK in both modes (116 modules in boot order).
- **Backend coverage:** `npm run test:coverage -- --ci` on Node 26 took 449 s: **1,004 suites passed, 49 skipped, 1 failed; 17,230 tests passed, 422 skipped, 1 failed. Coverage was 100 / 100 / 100 / 100.**
  - The one failure was `contracts/validation/featureFlag.validator.contract.test.ts`, which timed out at 19.6 s while the frontend gates ran alongside it. Run alone it passed 1/1.
  - The run before it had **0 failed** (1,005 suites; 17,228 tests), but branch coverage was 99.96 % in `calibrationDevices.service`. Six branches were then closed in `calibrationDevices.register.p2102`, and the re-run is the one quoted above.
  - After that run, `calibrationDevices.openapi.ts` gained a path-parameter example and `calibrationDevices.register.p2102` lost one line that asserted nothing. The touched suites, the OpenAPI checks and the featureFlag suite were re-run: 40/40.
- **Contracts:** `npm test`: 63 suites, 1,383 tests, 100 %.
- **OpenAPI:** `openapi:generate` (550 operations); `openapi:check` current; `openapi:lint`: no new error (15 warnings, baselined). The first lint run found `cf-path-parameter-example` on `by-qr/{qrCode}`, which is now fixed. `openapi:breaking` was not run locally because oasdiff is not installed.
- **Frontend** (`schema.d.ts` regenerated): `npm run typecheck`: 0 errors. `npx jest --ci --coverage`: **320/320 suites, 3,480 tests**, at 94.16 / 85.07 / 90 / 94.8. The warehouse page's two list assertions were re-based on `kind: "store"`.
- **Live:** `npm run test:live -- --only=p2105,p2002,p2104,p2103,p2007,p2004` passed **7 of 7 suites** (`p2105` is new, 4/4). It used container `p2105-pg18` on 127.0.0.1:55215, removed by name afterwards. No migration or trigger changed, so the full set was not run.

## Not done / open

- **OA-7** (owner/SME): the meaning of the typed registration date; changes only P24-02's mapping.
- The recap reads (`dateField`, `latestOnly`, `entryKind` on `GET /calibration-records`, spec § 8) are **P21-06**'s (now TODO).
- The quick entry's frontend is **P22-05** (now TODO).
- `openapi:breaking` to be confirmed in CI (oasdiff not installed locally); the changes add operations and optional fields — but `limit`'s maximum rose (100 → 200), and the device list's rows gained fields.
