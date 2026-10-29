# P24-05: the first dry run of a real upstream dump — every automated check green, three findings

**Date:** 2026-10-28 · **Card:** P24-05 · **Status:** DONE for the database. The photos (~91 GB) are a separate run; see "Not done" · **Basis:** the owner's decisions of 2026-10-28 (UD-18 legal basis, UD-7 zone — [record](./2026-10-28-owner-answers-oa-ud.md)) · **Also in this change:** R-7 counts the device dates (P25-01)

## How it ran

[`backend/scripts/upstream-dry-run.ts`](../../backend/scripts/upstream-dry-run.ts) is new and is never run in CI. It runs the pipeline as the backend runs it:

1. migrations on a throwaway PostgreSQL 18 (`pgvector/pgvector:pg18`);
2. the seeded roles;
3. a provider tenant with its self facility, an operator, and the import key;
4. upload of the dump as `real` → ClamAV 1.4 scan → parse → staging;
5. the transform into the provider tenant;
6. P25-01 reconciliation and the P25-02 data-quality report.

Safeguards:

- It refuses a database whose name lacks "scratch".
- It turns SQL logging off.
- On a failed transform it re-runs the transform with each step tagged, and keeps only the step, the SQLSTATE, the constraint, the table and the column, with every value in the message redacted.
- It writes counts, codes and durations only.

The containers, the database and the run log were removed after the run. No copy of the dump was left in the quarantine.

The first attempt failed in the `users` step: the scratch database had no seeded roles. That was a harness gap, not a transform defect, and the script now seeds the roles first. The script's database writes were later rewritten through `sql()` to pass lint; that did not change the logic.

## The dump

`2026-10-06-skp_ipm.sql`, the latest: 41 MB, 43 MB uncompressed.

**Stage 1:**

- 371,335 rows staged from 52 tables.
- 0 rejected.
- 13,163 not extracted: NEVER-COPIED columns and NOT-MIGRATED tables, by design.

## Timings

| Stage | Duration |
|---|---|
| migrations | 16.5 s |
| upload + scan + parse + staging | 26.2 s |
| **transform** | **1,022.7 s (17 min)** |
| reconciliation | 28.4 s |
| data-quality report | 10.5 s |

The transform, per step:

| Step | ms | Sources (staged → mapped; quarantined) |
|---|---:|---|
| client_facilities | 1,429 | mst_faskes 118 → 115; facility_without_devices 3 |
| users | 2,577 | users 106 → 105 (user_without_group 1); groups 4, memberships 105, mappings 60 |
| device_types | 267 | 344 → 344 |
| inspection_item_definitions | 917 | 501 → 500; session_header_value 1 |
| inspection_templates | 1,385 | 2,876 staged, 2,010 mapped; **item_content_incomplete 866** (mapping_keamanan_listrik 638 of 638, mapping_kinerja_alat 228 of 282) |
| vendors | 673 | derived |
| warehouses | 40,947 | derived (rooms) |
| calibration_devices | 15,343 | 23,722 → 23,722 |
| attachments | 111,617 | certificate index 11,851 archived offline. Photos 47,444 → `file_missing` (no image import in this run) |
| calibration_records | 14,719 | trx_kalibrasi 3,640 → 3,640. **tgl_kalibrasi 23,722 → 23,659, of which 22,215 are records of their own and 1,444 map onto the same-day trx_kalibrasi record; future_calibration_date 63** |
| inspection_sessions | 420,802 | 8,182 headers → 8,153; no_device 13 and duplicate_header 14–16 per table |
| inspection_results | 407,575 | 294,756 results → mapped. session_not_imported 518, value_out_of_range 9 |
| audit_logs | 3,373 | 357,838 audit rows in the database |

The database ended at 633 MB.

## Reconciliation (P25-01) on real volumes: every automated check passes

- **Run level:** R-10 371,335 / 371,335 (13,362 quarantined). R-11, RC-F1, RC-F2, RC-F3 and RC-F5 are 0. R-9 is 105 / 105. R-8 is 47,444 / 47,444, all quarantined, because no photos were in this run.
- **Per facility, 115 facilities, 0 failing:**
  - R-1: 23,722 devices.
  - R-2: 8,153 sessions.
  - R-3 and R-4: 294,756 results, every outcome by its code map.
  - R-5: 13,872 readings.
  - R-6: 16,419 environment readings.
  - R-7: 3,640.
- The run used R-7 as it stood before this change, which counted `trx_kalibrasi` only. R-7 now adds the device dates; that is proven live on synthetic data (see Tests).

## Data quality (P25-02): matches the research

| Finding | Dry run | Research (03 § 7) |
|---|---:|---:|
| Q-2 IPM rows, performer not imported | 13,165 | 13,169 |
| Q-3 devices, registrant not imported | 2,294 | 2,294 |
| Q-10 calibrations, performer not imported | 1,235 | 1,235 |
| Q-4 sessions with no device | 52 (13 × 4 tables) | 13 sessions |
| Q-8 duplicate headers | 61 | 16 |
| Q-12 future dates | 8 (and 63 future device dates quarantined) | 8 + 63 |
| Q-13 dates before 2023 | 93 | 65 + 27 |
| Q-18 case-variant duplicate serials | 0 | 0 expected (UD-9) |
| Q-19 serials shared across facilities | 397 | 168 values |
| **Q-9 devices with more than one live calibration** | **2,124** | 110 (trx_kalibrasi only) |
| **Q-14 calibration before inventory** | **22,854** | 1,445 |

Q-9 and Q-14 grew because the device dates are now records. Q-28's unreferenced half answers 0, because no image import was in the run.

## Findings

1. **The transform takes 17 minutes, not the runbook's 2–10.** The IPM steps account for 14 of them. The freeze estimate in the runbook (§ 7) is replaced by these figures. The photos will add to step 9's time. An optimisation of the IPM steps is a separate card if the window matters.
2. **No electrical-safety template is imported.** All 638 `mapping_keamanan_listrik` rows and 228 of 282 `mapping_kinerja_alat` rows are quarantined as `item_content_incomplete`. The IPM items for electrical safety and most performance items then exist only as definitions without a published template. **This is the next card to investigate**, to decide whether it is the data or the template rule.
3. **Q-14 is 22,854.** Most device calibration dates precede the device's `tgl_inventory`. The likely reading is that `tgl_inventory` is the date the device was registered in the upstream app (which started in 2024, 03 Q-15), not its acquisition date. That is plausible and flagged, not an error. It is worth one sentence from the owner.

## Tests for the R-7 change

| Suite | Result |
|---|---|
| `services/upstreamReconciliation.p2501` | 8/8. R-7 now sums the device dates on both sides |
| `routes/upstreamReconciliation.route.p2501` | 3/3 |
| **Live, PostgreSQL 18:** `p2402f` | 4/4. R-7 passes 5/5 (3 trx_kalibrasi + 2 device dates; QR-F101's date names calibration 1's record and counts once on each side) |
| Live, PostgreSQL 18: `p2402g`, `p2403` | pass |
| Guards: `src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll` | 45 suites, 343 tests |
| typecheck (source) | 0 errors |
| eslint on the changed files and the script | clean |

## Not done

- **The photos.** The rsync image import of `foto_depan` / `foto_sn` (~47 k files, ~91 GB) into a throwaway bucket, then step 9 against real files. It is a separate run, starting with a sample.
- P25-03 (the sampled field-by-field report diff) and P25-04 (the operator's signed reconciliation) can now use this dry run's database shape.
- The template finding above.
