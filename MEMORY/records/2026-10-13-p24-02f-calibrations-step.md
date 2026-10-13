# P24-02f: the upstream transform's calibrations step

**Date:** 2026-10-13 · **Card:** P24-02f (the sixth part of P24-02) · **ADR:** ADR-129 Amendment 8 · **Status:** DONE.

The transform stays **not available** (409, `TRANSFORM_NOT_BUILT`). Step 9 (attachments, P24-03) and steps 11 and 12 (sessions and results, P24-02g) are not built, so the end-to-end synthetic transform is still to come. P24-02g was not started: the batch's card cap was reached.

## What was built

| | |
|---|---|
| `transform/calibrations.ts` (step 10) | Turns `trx_kalibrasi` into `external_date` records. Each takes the device from step 8 and the device's facility, the date at 00:00 in the source zone, and the room snapshot; no lab and no result.<br>**Actor:** a mapped user, else the tenant's import key. The key's snapshot is "Former upstream user #<n>" or "Upstream import" (`source: upstream-import`).<br>**Quarantine:** `no_device`, `value_out_of_range`, `future_calibration_date`, `performer_not_found`.<br>**No usable key** while a row needs one fails the transform `IMPORT_KEY_MISSING`.<br>**Re-runs:** a changed date becomes an import correction (a new record with `supersedes_id`; the old one closed). Records the operator voided or corrected are left alone. The step writes its own audit: CREATE, CREATE-correction, UPDATE-superseded |
| `transform/people.ts` (new, shared) | `mappedTargets`, `peopleOf` (the person snapshot, plus `unmatched`), and `numberFormerUsers` / `formerUsersOf` / `recordFormerUsers` / `formerSnapshot`. `inventory.ts` now uses them, with no change in behaviour (the P24-02e unit and live suites pass unchanged) |
| `importKey.ts` | `usableImportKey` exported, taking a structural key state. The service and the transform judge the key by one rule |
| `auditRows.ts`, `steps.ts` | `STEP_AUDITED` += `calibration_records`; step 10 registered |
| Migration `0140-upstream-transform-calibrations` | Reason CHECK (+`performer_not_found`). Column grants: `calibration_records` gets read of the keys, insert of the import columns, and update of `superseded_by_id`, `superseded_at` and `updated_at` only. `api_keys` gets read of the state, never `key_hash` or `key_prefix` |
| Contracts | +`performer_not_found` (31 reasons), +`IMPORT_KEY_MISSING` (transform error codes); `openapi.json` and `schema.d.ts` regenerated (the error-code enum) |
| Guards | G-14: `people.ts#${table}`, `people.ts#users`, `calibrations.ts#${table}`, `#audit_logs`, `#calibration_devices`, `#calibration_records`. The stale `inventory.ts#users` entry removed. D-05: `people.ts#${table}`, `calibrations.ts#${table}`, `#audit_logs` |

## Tests (named)

- **Unit:**
  - `services/upstreamImport/transform.p2402f` (new): the registry; the calendar day; the plan covering three performers, every quarantine reason, the re-runs, the missing key and ties; the step's statements and binds; `IMPORT_KEY_MISSING` before any write.
  - `migrations/0140-upstream-transform-calibrations.p2402f` (new): 8 tests.
  - `transform.p2402e` still 20/20 on the refactor. `importKey.p2404` is unchanged and green.
  - Contracts `upstreamSqlImport.p2401`.
  - Coverage: `calibrations.ts`, `people.ts`, `inventory.ts`, `importKey.ts` and `0140` are at 100 / 100 / 100 / 100.
- **Live, PostgreSQL 18** (`la-pg18` 127.0.0.1:56240): `upstreamTransform.p2402f` (new), **4/4**:
  - **0140:** down/up/up is stable. The transform role cannot read `key_hash`, update `notes`, or DELETE.
  - **No key:** the transform fails `IMPORT_KEY_MISSING`, and not even a device is written.
  - **With the key:** 5 staged rows give 3 records, plus 1 `no_device` and 1 `future_calibration_date`. The person, the former user #1 and "Upstream import" are recorded, with `api_key_id` on the last two. 2025-04-01 is stored as 2025-03-31 17:00 UTC (Asia/Jakarta). Upstream `created_at` is kept; the facility is the device's; no lab. Audit: 3 CREATE.
  - **Re-runs:** the same values write nothing. A changed date gives a correction chain (old closed, new `supersedes_id` with reason), the mapping moves to the new record, and the audit gains CREATE-correction + UPDATE-superseded.
  - Also re-run:
    - `p2402e` 3/3, `p2402d` 3/3, `p2402c` 3/3, `p2402b` 4/4, `p2401` 8/8;
    - `p2402a` 7/7 (changed: `calibration_records` is now probed by an ungranted column);
    - `p2004` 15/15, `p2002` 21/21, `uifix` 3/3.
- **OpenAPI:** `openapi:check` current; `openapi:lint` shows no new error; `api:types:check` current.

## Left for later

- **P24-02g:** sessions and results (steps 11 and 12). With P24-03 (attachments, step 9), these are the last steps before the 409 lifts. Only then can the full synthetic transform be proved end to end on PostgreSQL 18.
- **Dry run (P24-05):** provision the import key before the load; count `performer_not_found` and `future_calibration_date`.

## Files

- `backend/src/services/upstreamImport/transform/calibrations.ts` (new), `people.ts` (new), `inventory.ts`, `steps.ts`, `auditRows.ts`
- `backend/src/services/upstreamImport/importKey.ts`
- `backend/src/migrations/0140-upstream-transform-calibrations.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/constants/facilityAccess.ts`, `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.js`, `backend/scripts/live-suites.ts`
- `packages/contracts/src/upstreamSqlImport.ts`, `packages/contracts/test/upstreamSqlImport.p2401.test.ts`
- `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts`
- tests:
  - new: `backend/src/tests/services/upstreamImport/transform.p2402f.test.ts`, `backend/src/tests/migrations/0140-upstream-transform-calibrations.p2402f.test.ts`, `backend/src/tests/migrations/upstreamTransform.p2402f.live.test.ts`
  - changed: `backend/src/tests/migrations/upstreamTransform.p2402a.live.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-129 Am. 8), `docs/UPSTREAM/05-DATA-MIGRATION.md`, `MEMORY/specs/P19-05-calibration-dates.md` (§ 9.2 note), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`
