# P20-02 + P20-08: the device extensions, the calibration-date columns and the photo purpose (migrations 0128, 0129)

**Date:** 2026-10-09 · **Tasks:** P20-02, P20-08 (Phase 20) · **Decisions:** ADR-132 Amendment 1, ADR-133 Amendment 1 · **Specs:** [`P19-03`](../specs/P19-03-device-extensions.md) § 4, § 6, § 7.1; [`P19-05`](../specs/P19-05-calibration-dates.md) § 4; [`P19-02`](../specs/P19-02-ipm-session-aggregate.md) § 12 · **Base commit:** `5fbd50c`

> **Privacy:** every fixture is synthetic ("Ruang 1", QR `TST000001`, "Lab Sintetis", "Former upstream user #7"). No upstream value is used, and `mozivid/` was not touched.

## What was built

| | |
|---|---|
| Migration 0128 (P20-02) | **calibration_devices:** `qr_code`, `inventoried_on`, `accessories_complete`, `condition` + `_changed_at` + `_source`, `calibration_vendor_id` → vendors SET NULL, `created_by` → users RESTRICT, `registrant_snapshot`, `ipm_interval_months`, `client_ref`, `next_calibration_date_source`, `calibration_requested_at`, `calibration_requested_by_session_id` → inspection_sessions RESTRICT (single column, migration only). **warehouses:** `kind` (NOT NULL DEFAULT `store`), `floor`. **calibration_records:** `entry_kind` (NOT NULL DEFAULT `full_record`), `calibration_vendor_id`, `external_lab_name`, `room_snapshot`, `floor_snapshot`, `performer_snapshot`. It creates 5 ENUM types (unless sync made them), 11 CHECKs and 8 indexes: the QR unique per tenant over every row, `client_ref` per creator, the room name per facility among live rooms (an expression index), and a leading index on every new key. It adds 4 triggers, all ENABLE ALWAYS: `calibration_devices_location_facility`, `calibration_devices_request_same_device`, `calibration_devices_next_date_source` and `warehouses_room_devices_facility`. The one back-fill sets the source to `manual` where a date exists. It reuses 0117's `calibration_devices_tenant_id_id_unique` and 0118's serial index. `down` refuses while a new column holds data |
| Migration 0129 (P20-08) | `attachments.purpose` with `attachments_purpose_values` and `attachments_purpose_resource`, and `attachments_one_live_device_photo`. It adds `inspectionsession` to `attachments_facility_kind` and to four functions: `facility_resource_device` / `_facility` (a new branch), plus `facility_insert_default` and `attachments_facility_matches_resource` (the widened list). Every other byte of each function is its previous migration's (0117, 0126, 0123); the unit test proves it. It adds `inspection_sessions_attachments_follow_facility`. `down` refuses while a purpose or an IPM photo exists, and restores the previous functions and the CHECK exactly |
| Models | `CalibrationDevice` (+14 attributes), `CalibrationRecord` (+6), `Warehouse` (+2), `Attachment` (+`purpose`, `isIn` the contract). No index, no association, no `references` on the session key |
| Contracts | `deviceValues.ts`: `DEVICE_CONDITIONS`, `DEVICE_CONDITION_SOURCES`, `WAREHOUSE_KINDS`, `CALIBRATION_ENTRY_KINDS`, `NEXT_CALIBRATION_DATE_SOURCES`, `ATTACHMENT_PURPOSES`, `SINGLE_DEVICE_PHOTO_PURPOSES`, `QR_CODE_PATTERN`, `IPM_INTERVAL_MONTHS_MAX`, `INVENTORIED_ON_MIN` |
| Service | `deviceMove.service` `linkedChildIds` includes IPM sessions, so a session's photos move with it (0129's follow trigger would refuse the commit otherwise) |
| Registrations | `schemaVerify` (+18 control objects, 124 in total), the D-27 shapes `CalibrationDevice.registrantSnapshot` and `CalibrationRecord.performerSnapshot`, the manifest, the live manifest (`p2002`). Guards updated: D-26 (+5 ENUMs), D-27 (31 columns), A-148 (+3 keys), D-24 (+1 reviewed findAll), D-20 (0128's expression index is a reviewed unreadable site), p605 |

No routes. The QR lookup, photos and room find-or-create belong to P21-02; the date derivation and the quick entry belong to P21-05.

## What surprised me (→ the amendments)

1. **The spec's `calibration_records_external_has_lab` passed on NULL.** `performer_snapshot->>'source' = 'upstream-import'` is NULL when there is no snapshot, and a CHECK accepts NULL. The live suite shows an external date with no lab accepted under the literal predicate. 0128 uses `coalesce(…, '')` instead (ADR-133 Am. 1 § 2).
2. **The source-pair CHECK would have broken every existing writer.** The device form, `createCalibrationRecord` and the import all write a date without a source; with the trigger disabled the live suite shows the 23514. A default trigger (`manual` / NULL) carries them until P21-05 (ADR-133 Am. 1 § 1).
3. **The room invariant had a back door.** A warehouse update could move a room, and so its devices, into another facility. `warehouses_room_devices_facility` closes it (ADR-132 Am. 1 § 2).
4. **A move with session photos would have failed at commit.** The move service listed the attachment owners by type and did not include IPM sessions; it does now.
5. **`LINKABLE_RESOURCES` stays as it is.** Adding `inspectionsession` would let the generic upload attach to submitted sessions without P19-02 § 12's rule. That is P21-03's job (ADR-132 Am. 1 § 5).

## Evidence — tests named

**Unit:**
- `tests/migrations/0128-0129-device-extensions.p2002.test.ts` (22): columns equal the models (type, length, nullability, default, key); ENUMs equal the contract; one transaction; back-fill before its CHECK; idempotent; no global unique; D-20 indexes; each prerequisite throws; `down` refuses and drops; 0129's functions are the previous text byte for byte plus the branch or list; `down` restores 0117's, 0123's and 0126's text and 0123's CHECK.
- `packages/contracts/test/deviceValues.p2002.test.ts` (6).

**Live, PostgreSQL 18** (`pgvector/pgvector:pg18`, container `p2002-pg18` on 127.0.0.1:55202, removed by name afterwards):
- `deviceExtensions.p2002.live` (21). Every refusal is checked as `callibrator_app` AND as the owner, and every control has a fail-before, the control removed in the rolled-back transaction: QR unique over deleted rows (23505; with the index dropped, accepted), QR shape (23514), condition pair, IPM interval, inventory floor, `client_ref` creator (23514), `client_ref` unique (23505), room CHECKs (23514), room name per facility with case and spaces folded (23505), location trigger on insert and update, for another facility's room and another tenant's store (23514), room-side trigger (23514), request same-device trigger and pair (23514), source trigger (the fail-before is today's writer refused, 23514), back-fill, external CHECKs (incl. the literal-predicate fail-before), record immutability (app: no UPDATE grant; owner: 42501 trigger), purpose CHECKs, one live front photo (23505), the IPM photo's facility (fail-before with the previous functions: stored with NO facility), a wrong facility refused at commit, the move (follow trigger 23514; with the photo moved it commits; without the device branch 42501), schemaVerify, reboot, `down` refuses, and down×2/up×2 gives the same objects and function bodies.
- Older suites adapted: `clientFacilities.p2007` and `upgradeBoot.am3` exclude 0128's two room triggers from the P20-07 count; `inspectionSessions.p2004` excludes 0129's follow trigger from the 0126/0127 count, and `p2004` and `inspectionCatalogue.p2003` revert 0129/0128 before 0127/0126. The first full run failed exactly these three, plus the am3 count.

## Gates (2026-10-09, quiet tree)

- **Lint:** `node scripts/ci/eslint-ratchet.js` reports 0 errors, 0 warnings, baseline 0. Contracts `npm run lint` is clean.
- **Typecheck:** `npm run typecheck` reports 0 errors (backend and contracts). **Ratchet:** 695 `.js` files, at the floor.
- **Load check:** `build:dist` OK (708 TypeScript files); `load:check` OK in both modes (698 modules / 112 in boot order).
- **Backend coverage:** `npm run test:coverage -- --ci` (Node 26): **984 suites passed, 46 skipped, 0 failed; 16,849 tests passed, 401 skipped; 100 / 100 / 100 / 100**, in 432 s.
- **Contracts:** `npm test`: 60 suites, 1,309 tests, 100 %.
- **OpenAPI:** `openapi:check` is current, so `schema.d.ts` is unchanged and the frontend gates were not needed.
- **Live:** `npm run test:live` passed **40 of 40 suites** on the final tree (`p2002` is new). The first full run failed `p2007`, `p2003` and `p2004` (trigger counts by name pattern and down/up order). Those were fixed in their tests, then the three were re-run (4/4), then the whole set was run again.
- **Upgrade boot:** `upgradeBoot.am3.live` with `AM3_UPGRADE_BASE=78f3784`: **10/10**. It applies 0117 – 0129. A new case checks that an existing store stays a store, an existing date is labelled `manual`, the record is a `full_record` and nothing else is filled. A second boot applies nothing.

## Not done / open

- **P21-02:** the QR lookup, `normaliseQrCode` (contracts), photos, room find-or-create, the associations (vendor, creator) with `required: false`, the A-9 warehouse markers, and the stock pickers filtering `kind = 'store'`.
- **P21-03:** `LINKABLE_RESOURCES.inspectionsession` together with the bound/draft upload rule.
- **P21-05:** write `record` explicitly when the date is derived, and decide whether the source trigger stays; measure `calibration_records_effective_device` against 0109.
- `docs/SECURITY/15` § 11 G-25 rows for P20-02/08 should be marked built. They are listed here and were not edited (owned by its author).
