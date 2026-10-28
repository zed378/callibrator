# P24-02h: the device's own calibration date (`trx_inventory.tgl_kalibrasi`) imported as a calibration record

**Date:** 2026-10-28 · **Card:** P24-02h (new) · **Status:** DONE (engineering, synthetic data; real volumes in P24-05) · **Decision:** ADR-133 Am. 5 · **Trigger:** UD-8 answered by the owner the same day ([record](./2026-10-28-owner-answers-oa-ud.md))

## Hook

The owner answered UD-8. `tgl_kalibrasi` is the date the operator calibrated the device, and the
interval is set per request or standard. The research had found the column differing from
`trx_kalibrasi` on 2,173 of 3,640 devices (03 Q-11), so a real share of the calibration history
existed only there. The import had kept it in `id_map.source_values` and nothing else.

## What changed

**[`backend/src/services/upstreamImport/transform/calibrations.ts`](../../backend/src/services/upstreamImport/transform/calibrations.ts)**
gains a second pass in step 10, after the `trx_kalibrasi` records:

| Part | What it does |
|---|---|
| `planInventoryDates` (pure) | Quarantines `no_device`, `value_out_of_range` and `future_calibration_date`. Skips an unchanged date, and a record the operator voided or corrected. Maps a date onto the device's **same-day effective record** (one calibration is one record). Otherwise inserts an `external_date` record: by the import key, "Upstream import", the device's room, no due date. A changed date is a correction |
| `readInventoryDates` | The run's staged device rows naming a date, each with its earlier `tgl_kalibrasi` mapping and record. The row hash is SHA-256 of the date alone |
| `accountInventoryDates` | The step's `account`: staged, mapped, unchanged, quarantined and unaccounted for the column source `tgl_kalibrasi`. An unaccounted row is fatal |

`runCalibrations` changes in three ways:

- It returns when neither staged table exists.
- It reads the tenant and the key once, in `tenantAndKey`.
- The two passes share `devicesOf` and `writeRecords`. `writeRecords` now takes the staged source
  table and the audit `sourceTable`.

[`steps.ts`](../../backend/src/services/upstreamImport/transform/steps.ts) registers
`accountInventoryDates` on step 10.

The decision is ADR-133 Am. 5. The docs updated with it: 04's D-7 row, the P19-05 spec's import
rule (marked superseded), and `PHASE-24`.

## Tests

| Suite | Result |
|---|---|
| `services/upstreamImport/transform.p2402h` (new) | **9/9**: every branch of the pure plan (the three quarantines, a new record's exact values and mapping, a timestamp keeping its day, same-day reuse, unchanged and closed left alone, a change as a correction, a missing key counted, a same-day mapping needing no key) |
| `transform.p2402f`, `transform.p2403` | updated for the behaviour change. Nothing staged now reads the two table checks (was one), and the registry's accounting steps are `attachments` and `calibration_records` |
| `src/tests/services/upstreamImport` (all), guards, `utils/rawSql*`, `services/unboundedFindAll` | 58 suites, 652 tests |
| **Live, PostgreSQL 18** (throwaway container, removed after): `upstreamTransform.p2402f.live` | **4/4.** QR-F101's date (2025-04-01) maps onto `trx_kalibrasi` #1's record. QR-F102's date (2024-12-15) becomes a record by the import key. Summary `tgl_kalibrasi` staged 2, mapped 2. The audit shows 4 CREATE (was 3). No device has a due date. The re-run reports `tgl_kalibrasi` unchanged 2 |
| Live, PostgreSQL 18: `p2401`, `p2402a` … `e`, `p2402g`, `p2403`, `p2409a` | all pass. `p2406` was not selected (it needs ClamAV, and touches no step) |
| typecheck (source) | 0 errors |
| eslint | clean |

## Not done

- R-7 of the reconciliation still counts `trx_kalibrasi` only. The device dates are accounted by
  the runner, not reconciled per facility yet.
- Real volumes: P24-05, the dry run on the real dump, is next and now unblocked.
