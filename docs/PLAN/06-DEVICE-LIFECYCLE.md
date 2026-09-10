# 06 — Device Lifecycle

The device is the central domain object. Almost every other table in the schema either describes a device, records something done to one, or governs who may do it.

Table of record: `calibration_devices` (`backend/src/models/calibrationDevice.model.js`).

---

## States

`calibration_devices.status` is an ENUM with exactly four values:

```
active ──▶ maintenance ──▶ active
   │                          
   ├──────▶ inactive ────────▶ active
   │
   └──────▶ retired          (terminal)
```

| Status | Meaning | Appears in scheduler? |
|---|---|---|
| `active` | in service, calibration interval applies | yes |
| `inactive` | temporarily out of service, interval paused | no |
| `maintenance` | under a maintenance work order | no |
| `retired` | permanently withdrawn | no |

`retired` is terminal by convention rather than by constraint. Reviving a retired device is possible at the database level and should not be — tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

**A device out of calibration interval does not change status.** Being overdue is a computed reportable state, not a stored one (BR-11). The platform makes the fact impossible to miss; it does not disable the device, because the decision to stop using an overdue defibrillator belongs to the facility, not to its inventory software.

## Fields That Drive the Lifecycle

| Column | Type | Role in the lifecycle |
|---|---|---|
| `serialNumber` | `STRING(100)`, unique | the identity the physical world uses |
| `installationDate` | `DATE` | start of the first interval |
| `calibrationIntervalDays` | `INTEGER` | how long a calibration remains valid |
| `nextCalibrationDate` | `DATE`, indexed | the derived due date — the single most-queried column in the system |
| `uncertaintyBudget` | `JSONB` | the measurement uncertainty model for this device |
| `readingTolerance` | `JSONB` | acceptable bounds, used for IoT anomaly detection |
| `recommendedCalibrationInterval` | `INTEGER` | derived proposal from history |
| `recommendationReason` | `TEXT` | why — a bare number nobody can justify gets ignored |
| `iotEnabled`, `iotDeviceToken` | `BOOLEAN`, `STRING` | telemetry ingest opt-in and credential |
| `locationId` | `UUID` → `warehouses.id`, `ON DELETE SET NULL` | physical location |

`nextCalibrationDate` is indexed because every scheduler query, dashboard tile and overdue report filters on it.

Note the delete rule on `locationId`: deleting a warehouse **nulls** the device location rather than cascading. Losing a warehouse record must never destroy device records.

## The Interval Cycle

```
installationDate
      │
      ├─ + calibrationIntervalDays ──▶ nextCalibrationDate
      │
      ▼
  calibration performed
      │
      ├─ calibration_records row written (append-only)
      ├─ nextCalibrationDate = calibrationDate + calibrationIntervalDays
      │
      ▼
  cycle repeats
```

The recalculation lives in `backend/src/services/calibrationScheduler.service.js`. It runs from the calibration write, not from a nightly job, so the due date is never stale relative to the record that determines it.

### Interval recommendation

Over time the system can propose a different interval from observed drift: a device that has passed comfortably for six consecutive cycles may not need a six-month interval, and one that has drifted close to tolerance may need a shorter one. The proposal is written to `recommendedCalibrationInterval` with `recommendationReason`.

**It is never applied automatically.** Changing a calibration interval is a quality decision with regulatory weight; the system proposes, a human with the right role disposes.

## Related Records Across the Lifecycle

```
                        calibration_devices
                                 │
      ┌──────────────┬───────────┼───────────┬──────────────┐
      ▼              ▼           ▼           ▼              ▼
calibration_    maintenance_  iot_       asset_        non_
  records       work_orders  readings   finances    conformances
      │
      ▼
 certificates ──▶ e_signature_records
```

| Related table | Relationship | Delete behaviour |
|---|---|---|
| `calibration_records` | one device, many records | soft delete (`paranoid`) |
| `certificates` | one calibration record, one certificate | soft delete |
| `maintenance_work_orders` | one device, many orders | soft delete |
| `iot_readings` | one device, many readings, indexed on `(device_id, timestamp)` | hard delete via retention policy |
| `asset_finances` | one device, one finance record — purchase price, depreciation method, useful life | soft delete |
| `non_conformances` | optional device link | soft delete |

`iot_readings` is the only one of these that is genuinely high-volume and the only one purged by retention rather than soft-deleted. That is the right asymmetry: telemetry is operational data, calibration history is evidence.

## Financial Lifecycle

`asset_finances` carries `purchasePrice`, `purchaseDate`, `salvageValue`, `usefulLifeYears`, and a `depreciationMethod` of `straight_line` or `declining_balance`, plus the acquiring `vendorId` and `invoiceNumber`.

This exists so that "should we recalibrate this or replace it" is answerable with numbers. A device with a shrinking book value and a rising maintenance cost is a replacement candidate, and that comparison needs both halves.

## Retirement

Retiring a device does **not** delete its history. Calibration records, certificates and audit entries persist, because the regulatory question "was this device in calibration on the day it was used" outlives the device by years.

Retention policies (`data_retention_policies`) may eventually purge, but they are per-entity-type and respect legal hold (BR-16). The default posture is retain.

## Where Devices Come From

| Path | Mechanism |
|---|---|
| Manual entry | `/dashboard/devices` |
| Bulk import | batch job (`batch_jobs`, type import) with progress tracking |
| API | `POST /api/v1/calibration-devices` with a scoped API key |
| SCIM | not applicable — SCIM provisions users, not devices |

Bulk import runs as a tracked batch job rather than a synchronous request specifically because a 5,000-row hospital inventory will exceed the 30-second request timeout (N3).
