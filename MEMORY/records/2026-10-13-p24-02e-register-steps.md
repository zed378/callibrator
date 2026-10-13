# P24-02e: the upstream transform's register steps (laboratories, rooms, devices)

**Date:** 2026-10-13 · **Card:** P24-02e (the fifth part of P24-02) · **ADR:** ADR-129 Amendment 7 · **Status:** DONE. The transform stays **not available** (409) until steps 9 … 12 are built (attachments wait on P24-03; P24-02f calibrations; P24-02g sessions and results).

## What was built

| | |
|---|---|
| `transform/inventory.ts` | **Step 6 (vendors, derived):** one `CalibrationLab` per cleaned, case-folded `lab_kalibrasi` in the provider tenant; a live one is adopted; the dump's first spelling names a new one. **Step 7 (rooms, derived):** one room per `(facility, room, floor)`, compared like `warehouses_room_name_unique`; adopted or created with the next `R-0001…` code; never derived from an upstream move. Both steps write their own CREATE audit rows. **Step 8 (`trx_inventory` → `calibration_devices`), by P19-03 § 10:** the QR from the tenant's own settings; condition, status, accessories and inventory date; a serial duplicated inside a facility is NULL on the newer rows; type, category, room and laboratory; the registrant's snapshot, or "Former upstream user #<n>"; upstream timestamps in the source zone. Changed rows are updated (never the facility); devices the operator deleted are left alone. Quarantine reasons: `facility_not_imported`, `value_out_of_range`, `qr_case_collision`, `qr_in_use`, `facility_changed` |
| `deviceSettings.service.ts` | `qrSettingsOf` extracted (pure). The register and the transform parse the QR settings the same way |
| `transform/auditRows.ts`, `steps.ts` | `STEP_AUDITED` += `vendors`, `warehouses`; steps 6–8 registered |
| Migration `0139-upstream-transform-register` | Reason CHECK (+`qr_in_use`, `facility_changed`); `upstream_import.former_users` (import role's, closed to the app role); **column-level** grants: vendors, warehouses, calibration_devices (UPDATE never on `client_facility_id`; nothing on `iot_token_hash`), tenant_settings, users (name, role, facility), tenants (id, name) |
| Contracts | +2 reasons (30) |
| Guards | D-05: `inventory.ts#${table}`, `#audit_logs`, `#vendors`, `#warehouses`. G-14: `#${table}`, `#audit_logs`, `#calibration_devices`, `#users`, `#warehouses`. All are worker statements with the provider tenant bound |

## Tests (named)

- **Unit:**
  - `services/upstreamImport/transform.p2402e` (new), 20 tests: every value rule; the plan in every branch (insert, update, unchanged, deleted, the move, the four other reasons, ties, the registrant three ways); the three steps' statements and binds.
  - `migrations/0139-upstream-transform-register.p2402e` (new), 13 tests.
  - Contracts `upstreamSqlImport.p2401`: 30 reasons.
- **Live, PostgreSQL 18** (`la-pg18` 127.0.0.1:56240, ClamAV `la-clamd` 13315):
  - `upstreamTransform.p2402e` (new): **3/3**.
    - **0139:** down/up/up is stable. The transform role cannot read `iot_token_hash` or DELETE a device; the app role cannot read `former_users`.
    - **First run:** 7 staged → 3 devices, with 4 quarantined: facility, case collision, in use, empty name. Two laboratories, one of them adopted. Two rooms, `R-0001`/`R-0002`. Every value is as § 10 says. `former_users` holds 99 → 1. Audit rows: 3 device, 1 vendor and 2 room CREATEs, devices stamped with their facility.
    - **Re-runs:** the same values write nothing. A rename gives one UPDATE. An upstream move is quarantined `facility_changed`, and the device stays in its facility.
  - **Live defects found and fixed in this card:**
    - The UPDATE set `client_facility_id`, which fired the deferred attachments-follow trigger (the transform role has no access to `attachments`). The facility is now never updated: the move rule.
    - A room and a laboratory took a lower-case spelling, because DISTINCT sorted by text. They now take the first spelling in the dump.
    - A room was created for a device that is quarantined as a move. Such rows are now excluded.
  - **Changed** to follow 0139's grants:
    - `p2401`: 8/8. The 0133 down/up comparison leaves out `former_users`; `tenants` and `calibration_devices` are probed by an ungranted column.
    - `p2402a`: 7/7. The same probe.
    - `p2402b`: 4/4. `users` SELECT now lists 0139's four columns.
  - Also re-run: `p2402c` 3/3, `p2402d` 3/3, `p2004` 15/15, `p2002` 21/21, `uifix` 3/3.
- **Guards and gates:** see the report to the coordinator (numbers from the run on this tree).

## Left for later

- **P24-02f:** calibrations. **P24-02g:** sessions and results. Attachments: P24-03.
- **Room merge list** (P19-03 § 6.5): not built. The dry run lists near-duplicates.
- **Dry run (P24-05):** the QR prefix must be set on the provider tenant before the load. Then count `qr_in_use` and `facility_changed`.

## Files

- `backend/src/services/upstreamImport/transform/inventory.ts` (new), `auditRows.ts`, `steps.ts`
- `backend/src/services/deviceSettings.service.ts`
- `backend/src/migrations/0139-upstream-transform-register.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/constants/facilityAccess.ts`, `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.js`, `backend/scripts/live-suites.ts`
- `packages/contracts/src/upstreamSqlImport.ts`, `packages/contracts/test/upstreamSqlImport.p2401.test.ts`
- tests:
  - new: `backend/src/tests/services/upstreamImport/transform.p2402e.test.ts`, `backend/src/tests/migrations/0139-upstream-transform-register.p2402e.test.ts`, `backend/src/tests/migrations/upstreamTransform.p2402e.live.test.ts`
  - changed: `backend/src/tests/migrations/upstreamImportGrants.p2401.live.test.ts`, `upstreamTransform.p2402a.live.test.ts`, `upstreamTransform.p2402b.live.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-129 Am. 7), `docs/UPSTREAM/05-DATA-MIGRATION.md`, `MEMORY/specs/P19-03-device-extensions.md` (§ 10 note), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`
