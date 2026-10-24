# Phase 24-25 audit: ETL + reconciliation vs spec — one transform defect fixed

**Date:** 2026-10-24 · **Cards:** P24-01 … P24-09, P25-01, P25-02 · **Spec refs:** [`TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`](../../TASKS/PHASE-24-UPSTREAM-DATA-ETL.md), [`TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md`](../../TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md), [`docs/UPSTREAM/05-DATA-MIGRATION.md`](../../docs/UPSTREAM/05-DATA-MIGRATION.md) § 3–7, ADR-129 Am. 1–11 · **Status:** 1 bug fixed, no phase status change (P24 stays 8 DONE · 1 BLOCKED, P25 stays PARTIAL + 2 BLOCKED)

## Verdict

The mechanism matches the spec: 13 transform steps registered and built ([`steps.ts`](../../../backend/src/services/upstreamImport/transform/steps.ts:85)), every staged table claimed exactly once, `id_map` + quarantine consistent (runner fails `TRANSFORM_INCOMPLETE` otherwise), reconciliation R-1/R-2/R-7 + R-10/R-11 + RC-F1/RC-F2/RC-F3/RC-F5 and data-quality Q-12/Q-13/Q-18/Q-19 computed with the rest `manual` per ADR-129 Am. 11. One real defect found and fixed (serial dedup case-sensitivity). No other blocking defect.

## Audit: 13 steps vs 05 § 3.1

| # | Step | Sources | Status |
|---|---|---|---|
| 1 | `client_facilities` ← `mst_faskes` | `mst_faskes` | built (P24-02a) |
| 2 | `users` ← users × groups × memberships × mappings | `users`, `auth_groups`, `auth_groups_users`, `trx_mapping_user_client` | built (P24-02b) |
| 3 | `device_types` ← `mst_alat` | `mst_alat` | built (P24-02c) |
| 4 | `inspection_item_definitions` ← 12 `mst_*` | 11 tables + `mst_rekomendasi_hasil_pekerjaan` (→ `session_header_value`) | built (P24-02c) |
| 5 | templates ← 5 `mapping_*` | 5 mapping tables | built (P24-02d) |
| 6 | `vendors` (derived) | none | built (P24-02e) |
| 7 | `warehouses` rooms (derived) | none | built (P24-02e) |
| 8 | `calibration_devices` ← `trx_inventory` | `trx_inventory` | built (P24-02e) |
| 9 | `attachments` ← manifests + `trx_inventory_file` | `trx_inventory_file` (+ photo folders accounted) | built (P24-03) |
| 10 | `calibration_records` ← `trx_kalibrasi` | `trx_kalibrasi` | built (P24-02f) |
| 11 | `inspection_sessions` ← 4 header tables | `trx_hasil_pemeriksaan`, `trx_hasil_maintenance`, `trx_rekomendasi_hasil_pekerjaan`, `trx_catatan` | built (P24-02g) |
| 12 | `inspection_results` ← 12 detail tables | 12 `trx_*` result tables | built (P24-02g) |
| 13 | `audit_logs` (derived) | none | built (P24-02a) |

41 staged tables ([`tablePolicy.ts`](../../../backend/src/services/upstreamImport/tablePolicy.ts:31)), each claimed once (`transformSteps.p2401` holds it). `isBuilt()` true since P24-03.

## Audit: id_map + quarantine vs 05 § 4–5

- `id_map (source_table, legacy_id)` PK → target/tenant/facility/run/hash/values; `legacy_id` text (session keys fit); `source_values` never for `users` (CHECK); written only by `callibrator_transform`, unreadable by `callibrator_app` (G-29).
- `quarantine (import_run_id, source_table, source_row_number, legacy_id, reason)` codes only from [`UPSTREAM_IMPORT_QUARANTINE_REASONS`](../../../packages/contracts/src/upstreamSqlImport.ts); re-run replaces the run's quarantine, `id_map` rows persist for hash comparison.
- Runner: one transaction, advisory lock, role proof, per-step `TRANSFORM_INCOMPLETE` on any unaccounted row, unclaimed-table check. Counts and codes only.

## Audit: reconciliation vs 05 § 7

Automated (proven live on PG18 synthetic data): R-1/R-2/R-7 per facility (mapped staged rows vs stored rows those mappings name), R-10 (registry walk), R-11, RC-F1, RC-F2, RC-F3, RC-F5 (FACILITY_BOUND_ROLES only). Q-12/Q-13/Q-18/Q-19 per facility + quarantine totals. Manual by design (ADR-129 Am. 11): R-3…R-6, R-8, R-9, RC-F4, R-12, Q-4, Q-14, Q-28 — each answers `manual`, P25-04 records by hand on the dry run. R-1/R-2/R-7 catch a lost/moved row, not a wrongly quarantined one (P25-02 covers that) — documented, not a defect.

## Bug fixed (B1): serial dedup was case-sensitive

**Spec:** 05 § 3.2 — dedupe keys `lower(btrim(x))`; Q-18 groups by `lower(serial_number)`; UD-9 keeps the serial on the oldest device of each group.

**Defect:** [`inventory.ts`](../../../backend/src/services/upstreamImport/transform/inventory.ts:280) keyed in-run duplicates as `${facilityId}|${serialNumber}` (case-sensitive) and [`runDevices`](../../../backend/src/services/upstreamImport/transform/inventory.ts:599) keyed the register's serials the same way, with an exact-match `= ANY()` lookup. `SN-DUP` and `sn-dup` in one facility both kept their serials; the second row then hit 0118's per-facility unique index (or, worse, slipped through on a re-run ordering). Q-18's `lower()` grouping would flag what the transform should have collapsed.

**Fix (2 lines, no migration):** both keys lower-cased; the register lookup uses `lower(serial_number) = ANY(lower-cased candidates)`. Stored serial keeps its original spelling; only the dedup key is folded.

**Test:** [`transform.p2402e.test.ts`](../../../backend/src/tests/services/upstreamImport/transform.p2402e.test.ts:241) — new case `sn-dup` loses to `SN-DUP` of the same facility, another facility keeps its spelling; the old fixture's `takenSerial` key corrected to lower-case (it encoded the bug). Fail-before shown: old test failed `SN-OPER` vs `null` after the fix until the fixture was corrected.

## Suites run (2026-10-24, this session)

| Suite | Result |
|---|---|
| Live PG18 `p2402g` (transform + P25-01/P25-02 on IPM world) | 6/6 |
| Live PG18 `p2403` (all 13 steps through the service) | 3/3 |
| Unit `transform.p2402e` + `upstreamReconciliation.p2501` + `upstreamDataQuality.p2502` + `transform.p2401` | 48/48 |
| Unit `transform.p2402e` alone after fix | 21/21 |

Coverage gate (100%) applies to the full run only; scoped runs above report no coverage by design.

## Still needs real data (not fixed here)

- P24-05 dry run (BLOCKED on UD-7/UD-18): latest dump → throwaway PG18 + bucket, every step timed, until P25-01 green. R-3…R-9, RC-F4, R-12, Q-4/Q-14/Q-28 exercised there.
- P25-03 sampled field-by-field diff and P25-04 operator sign-off (both BLOCKED).
- Real photo volumes (91 GB) and ClamAV/derivative throughput — measured in the dry run, not here.
- `UPSTREAM_REAL_DATA_ALLOWED` stays false; all fixtures synthetic.
