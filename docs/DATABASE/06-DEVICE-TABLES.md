# 06 — Device Tables

`calibration_devices` · `iot_readings` · `asset_finances`

---

## `calibration_devices` — `paranoid`

The hub of the operations layer.

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | `references tenants.id`, `ON DELETE CASCADE`, indexed |
| `name` | `STRING(255)` | required |
| `serialNumber` | `STRING(100)` | **`unique: true`** — indexed, see below |
| `manufacturer`, `model` | `STRING(255)` | |
| `category` | `STRING(100)` | |
| `status` | ENUM | `active`, `inactive`, `maintenance`, `retired` — indexed, default `active` |
| `locationId` | `UUID` | `references warehouses.id`, **`ON DELETE SET NULL`** |
| `installationDate` | `DATE` | |
| **`nextCalibrationDate`** | `DATE` | **indexed** — the most-queried column in the system |
| `calibrationIntervalDays` | `INTEGER` | |
| `uncertaintyBudget` | `JSONB` | ISO 17025 uncertainty model (migration `0009`) |
| `readingTolerance` | `JSONB` | bounds for IoT anomaly detection (migration `0010`) |
| `recommendedCalibrationInterval` | `INTEGER` | derived proposal |
| `recommendationReason` | `TEXT` | why |
| `iotEnabled` | `BOOLEAN` | telemetry opt-in |
| `iotDeviceToken` | `STRING` | device credential |
| `remarks` | `TEXT` | |
| `isDeleted` | `BOOLEAN` | indexed |

Indexes: `tenant_id`, `serial_number`, `status`, `next_calibration_date`, `is_deleted`.

### `serialNumber` is globally unique, and probably should not be

Declared `unique: true` on the column, which makes it unique **across all tenants**, not per tenant.

Two consequences:

1. Two hospitals cannot both register a device with the same manufacturer serial — which is a legitimate situation, since serials are unique per manufacturer, not per world.
2. A create that fails on uniqueness tells the caller that *some other tenant* holds that serial. That is a weak cross-tenant existence oracle.

The correct constraint is a composite unique on `(tenant_id, serial_number)`, ideally partial on `is_deleted = false` so a soft-deleted device does not hold its serial hostage indefinitely.

Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md). Documented here rather than presented as intentional.

### `nextCalibrationDate` is derived and indexed

```
create:      installationDate + calibrationIntervalDays
each calib:  calibrationDate  + calibrationIntervalDays
```

Recalculated from the calibration write, not by a nightly job, so it is never stale relative to the record that determines it.

Indexed because every scheduler query, dashboard tile and overdue report filters on it.

### `locationId` nulls rather than cascades

Deleting a warehouse nulls the device location. Losing a warehouse record must never destroy device records.

Contrast `tenantId`, which **does** cascade — deleting a tenant is meant to take its data.

### Status does not track calibration state

Passing `nextCalibrationDate` does **not** change `status` (BR-11). Overdue is a computed reportable state. The platform makes the fact impossible to miss; it does not disable the device, because the decision to stop using an overdue defibrillator belongs to the facility.

`retired` is terminal by convention, not by constraint — reviving a retired device is possible at the database level and should not be. Also tracked.

### `iotDeviceToken` is a credential

It must never appear in a list response, must be regenerable without recreating the device, and must be redacted in logs. A device token in a list payload is a credential leak to everyone who can read the device register.

### The two JSONB columns

| Column | Holds |
|---|---|
| `uncertaintyBudget` | the per-device model of contributing uncertainty components, from which `calibration_records.measurementUncertainty` is derived. ISO 17025 requires it documented. |
| `readingTolerance` | acceptable bounds, evaluated at IoT ingest to set `iot_readings.isAnomaly` |

JSONB in both cases because the shape differs by device class, and a schema that fits an infusion pump, a defibrillator and a centrifuge fits none of them well.

## `iot_readings`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `deviceId` | `UUID` | indexed |
| `timestamp` | `DATE` | indexed |
| `metrics` | `JSONB` | the reading |
| `isAnomaly` | `BOOLEAN` | computed **at ingest** |

Indexed on `tenant_id`, `device_id`, `timestamp`, and the pair **`(device_id, timestamp)`** — every query is "this device, this window".

### Anomaly is computed at write, not read

Evaluated against `calibration_devices.readingTolerance` at ingest. Anomaly detection that runs at query time cannot alert, which defeats the purpose of having it.

### Telemetry is not calibration

A device reporting itself within tolerance has not been calibrated. It has reported. Calibration requires a traceable reference standard and a competent human who signs for the result.

### Volume

The highest-volume table in the system and the **only one purged by retention policy** rather than soft-deleted. Telemetry is operational data; calibration history is evidence, and they are managed differently on purpose.

Not partitioned. That is the correct next step when retention alone stops being enough — tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## `asset_finances` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `deviceId` | `UUID` | indexed |
| `purchasePrice` | `DECIMAL` | |
| `purchaseDate` | `DATEONLY` | indexed |
| `salvageValue` | `DECIMAL` | |
| `usefulLifeYears` | `INTEGER` | |
| `depreciationMethod` | ENUM | `straight_line`, `declining_balance` |
| `vendorId` | `UUID` | who supplied it |
| `invoiceNumber` | `STRING` | |
| `notes` | `TEXT` | |

`DECIMAL` for money, never `FLOAT`. Binary floating point cannot represent common decimal fractions exactly, and a depreciation schedule that drifts by cents per period is a reconciliation problem later.

`DATEONLY` for `purchaseDate` because a purchase happens on a day, not at an instant, and storing a timestamp invites timezone-shifted dates.

This table is what makes "recalibrate or replace" answerable with numbers — book value next to accumulated maintenance cost. Without both halves it is an opinion.

Note this is the customer's device finance, **not** platform billing. Two different meanings of finance in one schema; see [`11-BILLING-TABLES.md`](./11-BILLING-TABLES.md).
